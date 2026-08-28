import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile, storePendingClaimToken } from '@/lib/queries/customer-profile'
import {
  useBookPublicAppointment,
  usePublicAvailableSlots,
  usePublicServices,
  type PublicService,
} from '@/lib/queries/public-booking'
import { bookingErrorKey, isSlotUnavailable } from '@/lib/booking/booking-error'
import { getErrorMessage } from '@/lib/get-error-message'
import { todayInZone } from '@/lib/calendar/time'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
} from '@/components/ui/bottom-sheet'
import { DateStrip } from '@/components/ui/date-strip'
import { TimeSlotGrid, firstPopulatedPart, type PartOfDay } from '@/components/ui/time-slot-grid'
import { AvailabilityLabel, availabilityFrom } from '@/components/ui/availability-label'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Alert } from '@/components/ui/alert'
import { useAnalytics } from '@/lib/analytics'
import { useDateTime, useMoney } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * BOOKING WITHOUT LEAVING THE MARKETPLACE
 * ============================================================================
 *
 * §11 and criterion J: once a barber is chosen, a booking must complete in at
 * most three primary interactions — service, slot, confirm — and must not feel
 * like a multi-screen wizard.
 *
 * The full wizard at `/s/:slug` still exists and is still the right surface for
 * someone who arrived at a shop's own page: it asks for a location, offers
 * every professional, explains service modes, and handles walk-in queues. What
 * it cannot be is fast, because it does not yet know who you want.
 *
 * This sheet is the other half. It opens with the shop, the location and the
 * professional already decided by the card the customer just expanded, so the
 * only questions left are the three that genuinely need answering.
 *
 *   1. SERVICE   a real list from list_public_services for THIS location
 *   2. SLOT      get_public_available_slots for this barber, service and day
 *   3. CONFIRM   one button for a signed-in customer; a name and one contact
 *                field for anyone else
 *
 * ============================================================================
 * WHY SERVICE COMES FIRST, EVEN THOUGH THE BARBER IS ALREADY CHOSEN
 * ============================================================================
 *
 * Because availability does not exist until it does. `get_public_available_slots`
 * needs a service, and it needs one because a slot is only free if it is long
 * enough for what is being booked — a 20-minute gap is available for a beard
 * trim and is not available for a cut and colour.
 *
 * That is also why the expanded card shows no "from HH:MM" against a barber
 * before this sheet opens: any such number would be true of one service and
 * silently presented as true of all of them.
 *
 * ============================================================================
 * THE CLAIM TOKEN IS NOT DROPPED
 * ============================================================================
 *
 * An anonymous booking returns a single-use token that later attaches the
 * appointment to an account. The wizard stores it; so does this. Forgetting it
 * here would mean bookings made from the marketplace could never be claimed,
 * and the customer would have no way of knowing that had happened.
 */

type Step = 'service' | 'slot' | 'confirm'

export interface InlineBookingTarget {
  organizationSlug: string
  organizationName: string
  locationId: string
  /** The SHOP's timezone. Every time in this sheet is written in it. */
  timeZone: string
  currency: string | undefined
  barberId: string
  barberDisplayName: string
  organizationId: string
}

export function InlineBookingSheet({
  target,
  onOpenChange,
  onBooked,
}: {
  /** Null closes the sheet. The target IS the open state — there is no way to
      have the sheet open without a shop, a location and a professional. */
  target: InlineBookingTarget | null
  onOpenChange: (open: boolean) => void
  onBooked?: () => void
}) {
  return (
    <BottomSheet open={target !== null} onOpenChange={onOpenChange}>
      <BottomSheetContent className="sm:mx-auto sm:max-w-xl">
        {/* Remounted per target: switching professionals inside one open sheet
            must not carry the previous one's chosen service or slot forward. */}
        {target ? (
          <BookingFlow key={`${target.barberId}`} target={target} onOpenChange={onOpenChange} onBooked={onBooked} />
        ) : null}
      </BottomSheetContent>
    </BottomSheet>
  )
}

function BookingFlow({
  target,
  onOpenChange,
  onBooked,
}: {
  target: InlineBookingTarget
  onOpenChange: (open: boolean) => void
  onBooked?: () => void
}) {
  const { t } = useTranslation('booking')
  const money = useMoney()
  const dt = useDateTime()
  const analytics = useAnalytics()
  const { user } = useAuth()

  const [step, setStep] = useState<Step>('service')
  const [service, setService] = useState<PublicService | null>(null)
  const [date, setDate] = useState(() => todayInZone(target.timeZone))
  const [slotStart, setSlotStart] = useState<string | null>(null)
  const [part, setPart] = useState<PartOfDay>('morning')
  const [confirmed, setConfirmed] = useState<{ startsAt: string } | null>(null)
  const [submitErrorKey, setSubmitErrorKey] = useState<string | null>(null)

  const servicesQuery = usePublicServices(target.organizationSlug, target.locationId)
  const slotsQuery = usePublicAvailableSlots(
    target.organizationSlug,
    target.locationId,
    target.barberId,
    service?.id,
    date,
  )

  const bookAppointment = useBookPublicAppointment()

  // Reported once, when the sheet actually becomes a booking attempt rather
  // than when the card was expanded — expanding a card to look at a team is
  // not a booking, and counting it as one would inflate every funnel above it.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // `booking_started` deliberately carries no properties — the taxonomy
    // says so, and the surface it began on is already answered by the
    // discovery_viewed / search_performed events above it in the funnel.
    analytics.track('booking_started', {
      properties: {},
      context: { organizationId: target.organizationId, barberId: target.barberId },
    })
  }, [analytics, target.organizationId, target.barberId])

  // Opens the slot list on a part of day that HAS something in it, so the
  // screen never arrives showing "nothing this morning" on a shop with a full
  // afternoon.
  const slots = slotsQuery.data ?? []
  const partInitialisedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!slotsQuery.isSuccess) return
    const key = `${service?.id}-${date}`
    if (partInitialisedRef.current === key) return
    partInitialisedRef.current = key
    setPart(firstPopulatedPart(slots, target.timeZone))
  }, [slotsQuery.isSuccess, slots, service?.id, date, target.timeZone])

  function chooseService(next: PublicService) {
    setService(next)
    setSlotStart(null)
    setStep('slot')
    analytics.track('booking_service_selected', {
      properties: { service_id: next.id },
      context: { organizationId: target.organizationId, barberId: target.barberId },
    })
  }

  function chooseSlot(next: string) {
    setSlotStart(next)
    setStep('confirm')
    analytics.track('booking_slot_selected', {
      properties: {
        // Whole minutes between now and the chosen start. The instant itself
        // is not sent: it identifies an appointment, and the funnel only ever
        // needs how far ahead people book.
        lead_time_minutes: Math.max(0, Math.round((new Date(next).getTime() - Date.now()) / 60_000)),
      },
      context: { organizationId: target.organizationId, barberId: target.barberId },
    })
  }

  /** The slot vanished under the customer. Send them back to a fresh list. */
  function loseSlot() {
    setSlotStart(null)
    setStep('slot')
    setSubmitErrorKey(null)
    void slotsQuery.refetch()
  }

  if (confirmed) {
    return (
      <ConfirmedPanel
        target={target}
        service={service}
        startsAt={confirmed.startsAt}
        onClose={() => {
          onOpenChange(false)
          onBooked?.()
        }}
      />
    )
  }

  return (
    <>
      <BottomSheetHeader>
        <BottomSheetTitle>
          {t('professional.bookWith', { professional: target.barberDisplayName })}
        </BottomSheetTitle>
        <BottomSheetDescription>{target.organizationName}</BottomSheetDescription>

        {/* Three dots, not a wizard chrome. The step a customer is on is
            legible from the content; this only says how much is left. */}
        <ol className="mt-2 flex items-center gap-1.5" aria-hidden="true">
          {(['service', 'slot', 'confirm'] as const).map((key) => (
            <li
              key={key}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
                stepIndex(step) > stepIndex(key)
                  ? 'bg-accent-600'
                  : stepIndex(step) === stepIndex(key)
                    ? 'bg-accent-200'
                    : 'bg-paper-200',
              )}
            />
          ))}
        </ol>
      </BottomSheetHeader>

      <BottomSheetBody className="flex flex-col gap-4">
        {step !== 'service' ? (
          <button
            type="button"
            onClick={() => setStep(step === 'confirm' ? 'slot' : 'service')}
            className="-ms-1 inline-flex min-h-[--fu-control-md] w-fit items-center gap-1 rounded-lg px-2 text-sm font-medium text-ink-700 hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {/* A literal "←" points the wrong way in Arabic. */}
            <ChevronLeft className="h-4 w-4 rtl:hidden" aria-hidden="true" />
            <ChevronRight className="hidden h-4 w-4 rtl:block" aria-hidden="true" />
            {t('common:action.back')}
          </button>
        ) : null}

        {step === 'service' ? (
          <ServiceStep
            query={servicesQuery}
            currency={target.currency}
            onChoose={chooseService}
            money={money}
            durationOf={dt.duration}
          />
        ) : null}

        {step === 'slot' && service ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center justify-between gap-3 rounded-lg border border-border bg-paper-100 px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium text-ink-950">{service.name}</span>
              <span className="shrink-0 text-ink-700">{money(service.priceCents, target.currency)}</span>
            </p>

            <DateStrip value={date} onChange={setDate} timeZone={target.timeZone} />

            {slotsQuery.isPending ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            ) : slotsQuery.isError ? (
              <ErrorState
                title={t('errors.times')}
                description={slotsQuery.error.message}
                action={
                  <Button variant="secondary" onClick={() => void slotsQuery.refetch()}>
                    {t('common:action.tryAgain')}
                  </Button>
                }
              />
            ) : slots.length === 0 ? (
              // A fully-booked day is a normal answer, not an error, and it is
              // said in a way that points at the fix: pick another day.
              <EmptyState icon={Clock} title={t('empty.times')} description={t('flow.tryADifferentDateThis')} />
            ) : (
              <>
                <AvailabilityLabel
                  state={availabilityFrom(slots, target.timeZone, {
                    isPending: false,
                    hasServiceContext: true,
                  })}
                />
                <TimeSlotGrid
                  slots={slots}
                  value={slotStart}
                  onChange={chooseSlot}
                  timeZone={target.timeZone}
                  part={part}
                  onPartChange={setPart}
                />
              </>
            )}
          </div>
        ) : null}

        {step === 'confirm' && service && slotStart ? (
          <ConfirmStep
            target={target}
            service={service}
            slotStart={slotStart}
            submitErrorKey={submitErrorKey}
            isSubmitting={bookAppointment.isPending}
            onSubmit={async (values) => {
              setSubmitErrorKey(null)
              try {
                const appointment = await bookAppointment.mutateAsync({
                  organizationSlug: target.organizationSlug,
                  locationId: target.locationId,
                  barberId: target.barberId,
                  serviceId: service.id,
                  startsAt: slotStart,
                  customerName: values.customerName,
                  customerPhone: values.customerPhone || null,
                  customerEmail: values.customerEmail || null,
                  notes: null,
                })
                // Anonymous booking: hold the one-time token so this booking
                // follows the customer into an account they create later. A
                // signed-in booking returns none — the server already linked it.
                if (!user && appointment.claimToken) {
                  storePendingClaimToken(appointment.claimToken)
                }
                setConfirmed({ startsAt: appointment.startsAt })
              } catch (error) {
                const rawMessage = getErrorMessage(error) ?? ''
                const key = bookingErrorKey(rawMessage)
                if (key === 'errors.generic') console.error('Booking failed:', rawMessage)
                if (isSlotUnavailable(key)) {
                  loseSlot()
                  return
                }
                setSubmitErrorKey(key)
              }
            }}
          />
        ) : null}
      </BottomSheetBody>
    </>
  )
}

function stepIndex(step: Step): number {
  return step === 'service' ? 0 : step === 'slot' ? 1 : 2
}

function ServiceStep({
  query,
  currency,
  onChoose,
  money,
  durationOf,
}: {
  query: ReturnType<typeof usePublicServices>
  currency: string | undefined
  onChoose: (service: PublicService) => void
  money: (cents: number | null | undefined, currency: string | null | undefined) => string
  durationOf: (minutes: number) => string
}) {
  const { t } = useTranslation('booking')

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <ErrorState
        title={t('errors.services')}
        description={query.error.message}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('common:action.tryAgain')}
          </Button>
        }
      />
    )
  }

  if (query.data.length === 0) {
    return <EmptyState title={t('empty.services')} description={t('empty.servicesHint')} />
  }

  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((service) => (
        <li key={service.id}>
          <button
            type="button"
            onClick={() => onChoose(service)}
            className={cn(
              'flex w-full min-h-[--fu-control-lg] items-center justify-between gap-4 rounded-xl border border-border bg-paper-0 px-4 py-3 text-start',
              'transition-colors duration-[--fu-duration-quick] hover:border-border-strong hover:bg-paper-100',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 motion-reduce:transition-none',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink-950">{service.name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {durationOf(service.durationMinutes)}
              </span>
            </span>
            <span className="shrink-0 font-semibold text-ink-950">{money(service.priceCents, currency)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

interface ConfirmFormValues {
  customerName: string
  customerPhone: string
  customerEmail: string
}

function ConfirmStep({
  target,
  service,
  slotStart,
  submitErrorKey,
  isSubmitting,
  onSubmit,
}: {
  target: InlineBookingTarget
  service: PublicService
  slotStart: string
  submitErrorKey: string | null
  isSubmitting: boolean
  onSubmit: (values: ConfirmFormValues) => Promise<void>
}) {
  const { t } = useTranslation('booking')
  const money = useMoney()
  const dt = useDateTime()
  const { user } = useAuth()
  const myProfile = useMyCustomerProfile(user?.id)

  const { register, handleSubmit, reset } = useForm<ConfirmFormValues>({
    defaultValues: { customerName: '', customerPhone: '', customerEmail: '' },
  })

  // A signed-in customer should not retype what they already told us. Fills
  // once, only from fields their own profile actually has, and never clobbers
  // typing that is already in progress.
  const prefilledRef = useRef(false)
  const profile = myProfile.data
  useEffect(() => {
    if (prefilledRef.current || !user || !profile) return
    prefilledRef.current = true
    reset({
      customerName: profile.displayName ?? '',
      customerPhone: profile.phone ?? '',
      customerEmail: profile.email ?? user.email ?? '',
    })
  }, [user, profile, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2 rounded-xl border border-border bg-paper-100 p-4 text-sm">
        <SummaryRow label={t('summary.barber')} value={target.barberDisplayName} />
        <SummaryRow label={t('summary.service')} value={service.name} />
        <SummaryRow label={t('summary.when')} value={dt.dateTime(slotStart, target.timeZone)} />
        <SummaryRow label={t('summary.price')} value={money(service.priceCents, target.currency)} />
      </dl>

      <TextField
        label={t('fields.fullName')}
        autoComplete="name"
        required
        {...register('customerName', { required: true })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('fields.phone')} type="tel" autoComplete="tel" {...register('customerPhone')} />
        <TextField label={t('fields.email')} type="email" autoComplete="email" {...register('customerEmail')} />
      </div>

      {submitErrorKey ? <Alert variant="error">{t(submitErrorKey)}</Alert> : null}

      <BottomSheetFooter className="px-0">
        <Button type="submit" variant="book" size="lg" isLoading={isSubmitting} className="w-full">
          {t('flow.confirmBooking')}
        </Button>
      </BottomSheetFooter>
    </form>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 truncate text-end font-medium text-ink-950">{value}</dd>
    </div>
  )
}

/**
 * The one moment in FadeUp that has earned a flourish — see the motion note in
 * index.css on `--fu-ease-spring`. `data-fu-confirm` is disabled wholesale
 * under prefers-reduced-motion, and the panel reads identically without it.
 */
function ConfirmedPanel({
  target,
  service,
  startsAt,
  onClose,
}: {
  target: InlineBookingTarget
  service: PublicService | null
  startsAt: string
  onClose: () => void
}) {
  const { t } = useTranslation('booking')
  const dt = useDateTime()

  return (
    <>
      <BottomSheetHeader>
        <BottomSheetTitle>{t('success.title')}</BottomSheetTitle>
        <BottomSheetDescription>{target.organizationName}</BottomSheetDescription>
      </BottomSheetHeader>

      <BottomSheetBody className="flex flex-col items-center gap-4 py-6 text-center">
        <span
          data-fu-confirm
          className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-100 text-accent-700"
        >
          <Check className="h-8 w-8" aria-hidden="true" />
        </span>
        <p className="text-heading text-ink-950">
          {dt.dateTime(startsAt, target.timeZone)}
        </p>
        {/* Built from the labels the success screen already uses rather than
            from a new sentence per shape — one fewer string to translate ten
            times, and it stays consistent with /s/:slug's own confirmation. */}
        <dl className="w-full max-w-sm text-start text-sm">
          <SummaryRow label={t('success.professional')} value={target.barberDisplayName} />
          {service ? <SummaryRow label={t('success.service')} value={service.name} /> : null}
        </dl>
      </BottomSheetBody>

      <BottomSheetFooter>
        <Button variant="secondary" size="lg" onClick={onClose} className="w-full">
          {t('common:action.close')}
        </Button>
      </BottomSheetFooter>
    </>
  )
}
