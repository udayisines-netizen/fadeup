import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, CalendarCheck2, CalendarPlus, Clock, MapPin, ShieldCheck } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import {
  usePublicAvailableSlots,
  usePublicBarbers,
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
  useBookPublicAppointment,
  type BookedAppointment,
  type PublicBarber,
  type PublicLocation,
  type PublicOrganization,
  type PublicService,
} from '@/lib/queries/public-booking'
import { useMyCustomerProfile, storePendingClaimToken } from '@/lib/queries/customer-profile'
import { useAuth } from '@/lib/auth-context'
import { Container } from '@/components/ui/container'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { DateStrip } from '@/components/ui/date-strip'
import { TimeSlotGrid, firstPopulatedPart, type PartOfDay } from '@/components/ui/time-slot-grid'
import { BookingCrumbs, BookingStepRail, type BookingCrumb, type BookingStep } from '@/components/booking/booking-steps'
import { useAnalytics, useTrackView } from '@/lib/analytics'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { getErrorMessage } from '@/lib/get-error-message'
import { bookingErrorKey, isSlotUnavailable } from '@/lib/booking/booking-error'
import { useMoney, useDateTime } from '@/lib/intl/use-intl'
import { todayInZone } from '@/lib/calendar/time'
import { downloadIcs } from '@/lib/calendar/ics'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * PUBLIC BOOKING — the most important screen FadeUp has
 * ============================================================================
 *
 * Everything else in the product exists so that this flow can happen. It is
 * also the only surface reached by people who have never seen FadeUp before,
 * usually on a phone, usually once.
 *
 * What V2 changes:
 *
 *   DATE       A native `<input type="date">` became a DateStrip. Picking
 *              "tomorrow" cost a date-picker dialog and three taps; it now
 *              costs one, and the customer can see the next three weeks
 *              without opening anything.
 *
 *   TIME       Forty buttons became three periods of the day. "Is there
 *              anything after work?" is now answerable without scrolling.
 *
 *   PROGRESS   The flow now says where you are, and the choices you have
 *              already made are editable chips rather than a Back chain.
 *
 *   LANGUAGE   Times were formatted with the BROWSER's locale and durations
 *              were hardcoded English ("1 hr 30 min"), inside a flow that is
 *              otherwise translated into ten languages. Both now go through
 *              the app's resolved locale.
 *
 *   TRUTH      The final button said "Request appointment" and the fine print
 *              said the shop would confirm it later. Since LOT E that is
 *              false — the appointment is confirmed the moment it is created.
 *              The copy now matches what the database actually does.
 *
 *   FAILURE    Booking errors were hardcoded English sentences. They are now
 *              translated, and a lost slot returns the customer to the time
 *              step with fresh availability instead of stranding them on a
 *              form whose submit can no longer succeed.
 *
 * The step machine itself is unchanged, deliberately: location → service →
 * professional → time → details is ordered by what the next query needs, and
 * it was already right.
 */

export function PublicBookingPage() {
  const { t } = useTranslation('booking')
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)

  useDocumentMeta({
    title: organizationQuery.data
      ? t('meta.titleWith', { organization: organizationQuery.data.name })
      : t('meta.title'),
    description: organizationQuery.data
      ? t('meta.descriptionWith', { organization: organizationQuery.data.name })
      : t('meta.description'),
  })

  if (organizationQuery.isPending) {
    return <PageSpinner label={t('loading')} />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('errors.page')}
          description={organizationQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void organizationQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </Container>
    )
  }

  if (!organizationQuery.data) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('errors.shopNotFound')}
          description={t('flow.thisBookingLinkMayBe')}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('flow.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  return <BookingWizard organization={organizationQuery.data} />
}

/**
 * Reads `?barber=<id>` (optionally `&location=<id>`, `&service=<id>`) — set by
 * marketplace cards, a professional's own profile, and "Rebook" links — so
 * arriving with a choice already made preserves it instead of asking again.
 */
function usePreselection() {
  const [searchParams] = useSearchParams()
  return {
    preselectedBarberId: searchParams.get('barber'),
    preselectedLocationId: searchParams.get('location'),
    preselectedServiceId: searchParams.get('service'),
  }
}

type Phase = 'location' | 'service' | 'barber' | 'datetime' | 'details'

const PHASE_ORDER: Phase[] = ['location', 'service', 'barber', 'datetime', 'details']

interface SlotSelection {
  slotStart: string
  slotEnd: string
}

function BookingWizard({ organization }: { organization: PublicOrganization }) {
  const { t } = useTranslation('booking')
  const dateTime = useDateTime()
  const locationsQuery = usePublicLocations(organization.slug)
  const { preselectedBarberId, preselectedLocationId, preselectedServiceId } = usePreselection()

  const analytics = useAnalytics()

  /**
   * INTENT, and only intent.
   *
   * Nothing in this wizard reports that an appointment was made. The
   * appointment_created / _confirmed / _completed events come from database
   * triggers on the appointments table, so they exist if and only if a row
   * does — a submit that fails, a slot that was taken in the meantime, or a
   * Service Mode guard that refuses the insert all produce no conversion
   * event, which is exactly §5's point. These four events measure where people
   * ABANDON, which is a question only the client can answer.
   */
  useTrackView(
    'booking_started',
    { properties: {}, context: { organizationId: organization.id } },
    true,
  )

  const [phase, setPhase] = useState<Phase>('location')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [barberId, setBarberId] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<SlotSelection | null>(null)
  const [bookingResult, setBookingResult] = useState<BookedAppointment | null>(null)
  /**
   * Steps the customer deliberately re-opened. Editing a choice that arrived
   * preselected has to also switch OFF the effect that applied it, or the
   * flow would bounce straight back out of the step they just asked for.
   */
  const [forced, setForced] = useState<Phase[]>([])

  const servicesQuery = usePublicServices(organization.slug, locationId ?? undefined)
  const barbersQuery = usePublicBarbers(organization.slug, locationId ?? undefined, serviceId ?? undefined)

  const selectedLocation = useMemo(
    () => locationsQuery.data?.find((location) => location.id === locationId) ?? null,
    [locationsQuery.data, locationId],
  )
  const timeZone = selectedLocation?.timezone ?? 'UTC'
  const dateKey = date ?? todayInZone(timeZone)

  const slotsQuery = usePublicAvailableSlots(
    organization.slug,
    locationId ?? undefined,
    barberId ?? undefined,
    serviceId ?? undefined,
    dateKey,
  )

  // Skip the location step when one was preselected (arriving from a
  // professional's profile) or the shop has exactly one — never make someone
  // tap through a question with a single possible answer.
  useEffect(() => {
    if (locationId || !locationsQuery.data || forced.includes('location')) return
    if (preselectedLocationId && locationsQuery.data.some((location) => location.id === preselectedLocationId)) {
      setLocationId(preselectedLocationId)
      setPhase('service')
      return
    }
    if (!preselectedLocationId && locationsQuery.data.length === 1) {
      setLocationId(locationsQuery.data[0]!.id)
      setPhase('service')
    }
  }, [locationsQuery.data, locationId, preselectedLocationId, forced])

  // Same for a preselected service, once it is confirmed to be offered at the
  // now-known location.
  useEffect(() => {
    if (!locationId || serviceId || phase !== 'service' || !preselectedServiceId || !servicesQuery.data) return
    if (forced.includes('service')) return
    if (servicesQuery.data.some((service) => service.id === preselectedServiceId)) {
      setServiceId(preselectedServiceId)
      setPhase('barber')
    }
  }, [servicesQuery.data, locationId, serviceId, phase, preselectedServiceId, forced])

  // Same for a preselected professional who turns out to be eligible, or a
  // service only one person offers.
  useEffect(() => {
    if (!serviceId || barberId || phase !== 'barber' || !barbersQuery.data || forced.includes('barber')) return
    if (preselectedBarberId && barbersQuery.data.some((barber) => barber.barberId === preselectedBarberId)) {
      setBarberId(preselectedBarberId)
      setPhase('datetime')
      return
    }
    if (barbersQuery.data.length === 1) {
      setBarberId(barbersQuery.data[0]!.barberId)
      setPhase('datetime')
    }
  }, [barbersQuery.data, serviceId, barberId, phase, preselectedBarberId, forced])

  const selectedService = useMemo(
    () => servicesQuery.data?.find((service) => service.id === serviceId) ?? null,
    [servicesQuery.data, serviceId],
  )
  const selectedBarber = useMemo(
    () => barbersQuery.data?.find((barber) => barber.barberId === barberId) ?? null,
    [barbersQuery.data, barberId],
  )

  /**
   * Which steps this particular booking is made of.
   *
   * Location and professional are CONDITIONAL: a one-location shop, or a
   * service only one person offers, genuinely has a shorter booking, and a
   * rail that counted screens the customer will never see would be lying.
   *
   * The rule for a step whose data has not loaded yet is "not counted". That
   * is deliberate: a counter can then only ever GROW ("step 2 of 3" becoming
   * "step 2 of 4" when a real choice appears), never shrink. Shrinking reads
   * as the flow having quietly dropped something.
   */
  function stepIsInFlow(step: Phase): boolean {
    if (step === phase || forced.includes(step)) return true
    switch (step) {
      case 'location':
        return Boolean(
          locationsQuery.data &&
            locationsQuery.data.length > 1 &&
            !(preselectedLocationId && locationsQuery.data.some((l) => l.id === preselectedLocationId)),
        )
      case 'service':
        // A preselected service is assumed to apply until proven otherwise:
        // the link expressed an intent, and honouring it optimistically keeps
        // the count stable through the load.
        return !(preselectedServiceId && (!servicesQuery.data || servicesQuery.data.some((s) => s.id === preselectedServiceId)))
      case 'barber':
        return Boolean(
          barbersQuery.data &&
            barbersQuery.data.length > 1 &&
            !(preselectedBarberId && barbersQuery.data.some((b) => b.barberId === preselectedBarberId)),
        )
      default:
        return true
    }
  }

  const steps: BookingStep[] = PHASE_ORDER.filter(stepIsInFlow).map((step) => ({
    key: step,
    label: t(`steps.${step}`),
  }))
  const currentIndex = Math.max(0, steps.findIndex((step) => step.key === phase))

  /**
   * Going back to an earlier decision clears everything downstream of it.
   * Changing the service while keeping a professional who may not offer it —
   * or a slot priced for the old service — is how a booking flow ends up
   * submitting something the customer never agreed to.
   */
  function editStep(target: Phase) {
    const targetIndex = PHASE_ORDER.indexOf(target)
    if (targetIndex <= PHASE_ORDER.indexOf('location')) {
      setLocationId(null)
    }
    if (targetIndex <= PHASE_ORDER.indexOf('service')) {
      setServiceId(null)
    }
    if (targetIndex <= PHASE_ORDER.indexOf('barber')) {
      setBarberId(null)
    }
    setSlot(null)
    // The step is being visited after all — which also switches off the
    // preselection effect that would otherwise bounce straight back out.
    setForced((current) => (current.includes(target) ? current : [...current, target]))
    setPhase(target)
  }

  const previousStep = steps[currentIndex - 1]

  // A crumb is only offered for a choice the customer could actually make
  // differently. A shop with one location has nothing to change.
  const crumbs: BookingCrumb[] = []
  if (selectedLocation && phase !== 'location' && stepIsInFlow('location')) {
    crumbs.push({ key: 'location', label: selectedLocation.name, onEdit: () => editStep('location') })
  }
  if (selectedService && phase !== 'service') {
    crumbs.push({ key: 'service', label: selectedService.name, onEdit: () => editStep('service') })
  }
  if (selectedBarber && phase !== 'barber' && stepIsInFlow('barber')) {
    crumbs.push({ key: 'barber', label: selectedBarber.displayName, onEdit: () => editStep('barber') })
  }
  if (slot && phase !== 'datetime') {
    crumbs.push({
      key: 'datetime',
      label: dateTime.dateTime(slot.slotStart, timeZone),
      onEdit: () => editStep('datetime'),
    })
  }

  if (bookingResult && selectedService && selectedBarber) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-10">
        <SuccessScreen
          organization={organization}
          service={selectedService}
          barber={selectedBarber}
          location={selectedLocation}
          appointment={bookingResult}
        />
      </Container>
    )
  }

  return (
    <Container size="sm" className="flex flex-1 flex-col gap-5 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          {previousStep ? (
            <button
              type="button"
              onClick={() => editStep(previousStep.key as Phase)}
              aria-label={t('common:action.back')}
              className="-ms-2 mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-700 hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-accent-600">
              {t('flow.bookAnAppointment')}
            </p>
            <h1 className="mt-0.5 text-balance text-2xl font-semibold text-ink-950">{organization.name}</h1>
          </div>
        </div>

        <BookingStepRail steps={steps} currentIndex={currentIndex} />
      </header>

      <BookingCrumbs crumbs={crumbs} />

      {phase === 'location' ? (
        <LocationStep
          query={locationsQuery}
          onSelect={(id) => {
            setLocationId(id)
            setServiceId(null)
            setBarberId(null)
            setSlot(null)
            setPhase('service')
          }}
        />
      ) : null}

      {phase === 'service' ? (
        <ServiceStep
          query={servicesQuery}
          currency={organization.currency}
          onSelect={(id) => {
            analytics.track('booking_service_selected', {
              properties: { service_id: id },
              context: { organizationId: organization.id, locationId },
            })
            setServiceId(id)
            setBarberId(null)
            setSlot(null)
            setPhase('barber')
          }}
        />
      ) : null}

      {phase === 'barber' ? (
        <BarberStep
          query={barbersQuery}
          onSelect={(id) => {
            analytics.track('booking_barber_selected', {
              properties: { any_available: false },
              context: { organizationId: organization.id, locationId, barberId: id },
            })
            setBarberId(id)
            setSlot(null)
            setPhase('datetime')
          }}
        />
      ) : null}

      {phase === 'datetime' ? (
        <DateTimeStep
          query={slotsQuery}
          timeZone={timeZone}
          dateKey={dateKey}
          selectedSlot={slot}
          onChangeDate={(next) => {
            setDate(next)
            setSlot(null)
          }}
          onSelectSlot={(next) => {
            analytics.track('booking_slot_selected', {
              properties: {
                /*
                 * How far AHEAD, never WHEN. §12 forbids future appointment
                 * details in analytics, and "how far in advance do customers
                 * book" is the question this is actually for. Clamped at zero
                 * so a clock skew cannot produce a negative the schema refuses.
                 */
                lead_time_minutes: Math.max(
                  0,
                  Math.round((new Date(next.slotStart).getTime() - Date.now()) / 60_000),
                ),
              },
              context: { organizationId: organization.id, locationId, barberId },
            })
            setSlot(next)
            setPhase('details')
          }}
        />
      ) : null}

      {phase === 'details' && selectedService && selectedBarber && slot ? (
        <DetailsStep
          organization={organization}
          location={selectedLocation}
          service={selectedService}
          barber={selectedBarber}
          slot={slot}
          timeZone={timeZone}
          onSlotLost={() => {
            setSlot(null)
            setPhase('datetime')
            void slotsQuery.refetch()
          }}
          onSuccess={setBookingResult}
        />
      ) : null}
    </Container>
  )
}

// --- step: location ---------------------------------------------------------

function LocationStep({
  query,
  onSelect,
}: {
  query: ReturnType<typeof usePublicLocations>
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('booking')

  return (
    <StepShell title={t('choose.location')}>
      {query.isPending ? (
        <StepSkeleton />
      ) : query.isError ? (
        <StepError title={t('errors.locations')} query={query} />
      ) : query.data.length === 0 ? (
        <EmptyState title={t('empty.locations')} description={t('empty.locationsHint')} />
      ) : (
        <div className="flex flex-col gap-2">
          {query.data.map((location) => (
            <SelectableRow key={location.id} onClick={() => onSelect(location.id)}>
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium text-ink-950">{location.name}</p>
                {formatAddress(location) ? (
                  <p className="mt-0.5 text-sm text-ink-500">{formatAddress(location)}</p>
                ) : null}
              </div>
            </SelectableRow>
          ))}
        </div>
      )}
    </StepShell>
  )
}

function formatAddress(location: PublicLocation): string | null {
  const parts = [location.addressLine1, location.addressLine2, location.city, location.region, location.postalCode]
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(', ') : null
}

// --- step: service ----------------------------------------------------------

function ServiceStep({
  query,
  currency,
  onSelect,
}: {
  query: ReturnType<typeof usePublicServices>
  /** The SHOP's currency — this is what the customer will actually be charged. */
  currency: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('booking')
  const money = useMoney()
  const dateTime = useDateTime()

  const grouped = useMemo(() => {
    const groups = new Map<string | null, PublicService[]>()
    for (const service of query.data ?? []) {
      const key = service.categoryName
      const bucket = groups.get(key) ?? []
      bucket.push(service)
      groups.set(key, bucket)
    }
    return groups
  }, [query.data])

  return (
    <StepShell title={t('choose.service')}>
      {query.isPending ? (
        <StepSkeleton />
      ) : query.isError ? (
        <StepError title={t('errors.services')} query={query} />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState title={t('empty.services')} description={t('empty.servicesHint')} />
      ) : (
        <div className="flex flex-col gap-5">
          {Array.from(grouped.entries()).map(([categoryName, services]) => (
            <div key={categoryName ?? '__uncategorised'}>
              {/* No invented "Services" heading for uncategorised items — a
                  shop that did not categorise gets a plain list. */}
              {categoryName ? (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">{categoryName}</h3>
              ) : null}
              <div className="flex flex-col gap-2">
                {services.map((service) => (
                  <SelectableRow key={service.id} onClick={() => onSelect(service.id)}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-950">{service.name}</p>
                      {service.description ? (
                        <p className="mt-0.5 text-sm text-ink-500">{service.description}</p>
                      ) : null}
                      <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {dateTime.duration(service.durationMinutes)}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold text-ink-950">{money(service.priceCents, currency)}</span>
                  </SelectableRow>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </StepShell>
  )
}

// --- step: professional -----------------------------------------------------

function BarberStep({
  query,
  onSelect,
}: {
  query: ReturnType<typeof usePublicBarbers>
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('booking')

  return (
    <StepShell title={t('choose.barber')}>
      {query.isPending ? (
        <StepSkeleton />
      ) : query.isError ? (
        <StepError title={t('errors.barbers')} query={query} />
      ) : query.data.length === 0 ? (
        <EmptyState title={t('empty.barbers')} description={t('empty.barbersHint')} />
      ) : (
        <div className="flex flex-col gap-2">
          {query.data.map((barber) => (
            <SelectableRow key={barber.barberId} onClick={() => onSelect(barber.barberId)}>
              <Avatar name={barber.displayName} src={barber.avatarUrl} size="md" />
              <div className="min-w-0">
                <p className="font-medium text-ink-950">{barber.displayName}</p>
                {barber.title ? <p className="text-sm text-ink-500">{barber.title}</p> : null}
                {barber.bio ? <p className="mt-1 text-sm text-pretty text-ink-500">{barber.bio}</p> : null}
              </div>
            </SelectableRow>
          ))}
        </div>
      )}
    </StepShell>
  )
}

// --- step: date + time ------------------------------------------------------

function DateTimeStep({
  query,
  timeZone,
  dateKey,
  selectedSlot,
  onChangeDate,
  onSelectSlot,
}: {
  query: ReturnType<typeof usePublicAvailableSlots>
  timeZone: string
  dateKey: string
  selectedSlot: SlotSelection | null
  onChangeDate: (dateKey: string) => void
  onSelectSlot: (slot: SlotSelection) => void
}) {
  const { t } = useTranslation('booking')
  const slots = useMemo(() => query.data ?? [], [query.data])

  const [part, setPart] = useState<PartOfDay>('morning')
  // Open on a period that actually has something in it. Keyed on the day
  // rather than on the slots array so that a background refetch returning an
  // equivalent list does not yank the customer to a different tab mid-choice.
  const settledFor = useRef<string | null>(null)
  useEffect(() => {
    if (slots.length === 0 || settledFor.current === dateKey) return
    settledFor.current = dateKey
    setPart(firstPopulatedPart(slots, timeZone))
  }, [slots, dateKey, timeZone])

  return (
    <StepShell title={t('flow.chooseADateTime')}>
      <div className="flex flex-col gap-4">
        <DateStrip value={dateKey} onChange={onChangeDate} timeZone={timeZone} />

        {query.isPending ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : query.isError ? (
          <StepError title={t('errors.times')} query={query} />
        ) : slots.length === 0 ? (
          <EmptyState title={t('empty.times')} description={t('flow.tryADifferentDateThis')} />
        ) : (
          <TimeSlotGrid
            slots={slots}
            value={selectedSlot?.slotStart ?? null}
            onChange={(slotStart) => {
              const chosen = slots.find((candidate) => candidate.slotStart === slotStart)
              if (chosen) onSelectSlot({ slotStart: chosen.slotStart, slotEnd: chosen.slotEnd })
            }}
            timeZone={timeZone}
            part={part}
            onPartChange={setPart}
          />
        )}
      </div>
    </StepShell>
  )
}

// --- step: details + confirm ------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validation messages are translation KEYS, resolved at render. Building the
 * schema with `t` instead would rebuild it on every language change and would
 * still leave already-rendered errors in the old language.
 */
const detailsSchema = z
  .object({
    customerName: z.string().trim().min(1, 'validation.nameRequired'),
    customerPhone: z.string().trim(),
    customerEmail: z.string().trim(),
    notes: z.string().trim(),
  })
  .refine((values) => values.customerPhone !== '' || values.customerEmail !== '', {
    message: 'validation.contactRequired',
    path: ['customerPhone'],
  })
  .refine((values) => values.customerEmail === '' || EMAIL_PATTERN.test(values.customerEmail), {
    message: 'validation.emailInvalid',
    path: ['customerEmail'],
  })

type DetailsFormValues = z.infer<typeof detailsSchema>

function DetailsStep({
  organization,
  location,
  service,
  barber,
  slot,
  timeZone,
  onSlotLost,
  onSuccess,
}: {
  organization: PublicOrganization
  location: PublicLocation | null
  service: PublicService
  barber: PublicBarber
  slot: SlotSelection
  timeZone: string
  onSlotLost: () => void
  onSuccess: (appointment: BookedAppointment) => void
}) {
  const { t } = useTranslation('booking')
  const money = useMoney()
  const dateTime = useDateTime()

  const bookAppointment = useBookPublicAppointment()
  const { user } = useAuth()
  const myProfile = useMyCustomerProfile(user?.id)
  const [submitErrorKey, setSubmitErrorKey] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DetailsFormValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { customerName: '', customerPhone: '', customerEmail: '', notes: '' },
  })

  // A signed-in customer should not retype what they already told us. Fills
  // once, from their own saved profile, and only fields that profile actually
  // has — never invents a value, and never clobbers typing.
  const prefilledRef = useRef(false)
  const profile = myProfile.data
  useEffect(() => {
    if (prefilledRef.current || !user || !profile) return
    prefilledRef.current = true
    reset({
      customerName: profile.displayName ?? '',
      customerPhone: profile.phone ?? '',
      customerEmail: profile.email ?? user.email ?? '',
      notes: '',
    })
  }, [user, profile, reset])

  async function onSubmit(values: DetailsFormValues) {
    setSubmitErrorKey(null)
    try {
      const appointment = await bookAppointment.mutateAsync({
        organizationSlug: organization.slug,
        locationId: location?.id ?? '',
        barberId: barber.barberId,
        serviceId: service.id,
        startsAt: slot.slotStart,
        customerName: values.customerName,
        customerPhone: values.customerPhone || null,
        customerEmail: values.customerEmail || null,
        notes: values.notes || null,
      })
      // Anonymous booking: hold on to the one-time claim token so that, if the
      // customer creates an account from the success screen, this booking
      // follows them into it. A signed-in booking returns no token — the
      // server already linked it.
      if (!user && appointment.claimToken) {
        storePendingClaimToken(appointment.claimToken)
      }
      onSuccess(appointment)
    } catch (error) {
      const rawMessage = getErrorMessage(error) ?? ''
      const key = bookingErrorKey(rawMessage)
      // Not swallowed — just not shown as raw Postgres text to a customer.
      if (key === 'errors.generic') console.error('Booking failed:', rawMessage)
      if (isSlotUnavailable(key)) {
        // The form can no longer succeed. Send them back to a fresh list of
        // times rather than leaving them to press a dead button.
        onSlotLost()
        return
      }
      setSubmitErrorKey(key)
    }
  }

  return (
    <StepShell title={t('summary.details')}>
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-border bg-paper-0 p-4">
          <dl className="flex flex-col gap-1.5 text-sm">
            <SummaryRow label={t('summary.shop')} value={organization.name} />
            {location ? <SummaryRow label={t('summary.location')} value={location.name} /> : null}
            <SummaryRow
              label={t('summary.service')}
              value={`${service.name} · ${dateTime.duration(service.durationMinutes)}`}
            />
            <SummaryRow label={t('summary.barber')} value={barber.displayName} />
            <SummaryRow label={t('summary.when')} value={dateTime.dateTime(slot.slotStart, timeZone)} />
            <SummaryRow label={t('summary.price')} value={money(service.priceCents, organization.currency)} />
          </dl>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {submitErrorKey ? <Alert variant="error">{t(submitErrorKey)}</Alert> : null}

          <TextField
            label={t('fields.fullName')}
            autoComplete="name"
            error={errors.customerName?.message ? t(errors.customerName.message) : undefined}
            {...register('customerName')}
          />
          <TextField
            label={t('fields.phone')}
            type="tel"
            autoComplete="tel"
            hint={t('fields.contactHint')}
            error={errors.customerPhone?.message ? t(errors.customerPhone.message) : undefined}
            {...register('customerPhone')}
          />
          <TextField
            label={t('fields.email')}
            type="email"
            autoComplete="email"
            error={errors.customerEmail?.message ? t(errors.customerEmail.message) : undefined}
            {...register('customerEmail')}
          />
          <Textarea label={t('fields.notes')} rows={3} {...register('notes')} />

          {/*
            Sticky on a phone. The form is long enough that the submit button
            leaves the screen while the customer fills it in, and the last
            action of the most important flow in the product should never
            require scrolling to find.
          */}
          <div
            className={cn(
              'sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-paper-0/95 px-4 py-3 backdrop-blur',
              'pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none',
            )}
          >
            <Button type="submit" size="lg" isLoading={isSubmitting} className="w-full">
              {t('flow.confirmBooking')}
            </Button>
            {/* Since LOT E this is true: the appointment is confirmed on
                creation. It used to say the opposite. */}
            <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500">
              <ShieldCheck className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
              {t('flow.instantConfirmation')}
            </p>
          </div>
        </form>
      </div>
    </StepShell>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="text-end font-medium text-ink-950">{value}</dd>
    </div>
  )
}

// --- success ----------------------------------------------------------------

function SuccessScreen({
  organization,
  service,
  barber,
  location,
  appointment,
}: {
  organization: PublicOrganization
  service: PublicService
  barber: PublicBarber
  location: PublicLocation | null
  appointment: BookedAppointment
}) {
  const { t } = useTranslation('booking')
  const money = useMoney()
  const dt = useDateTime()
  const reduced = useReducedMotion()
  const timeZone = location?.timezone ?? 'UTC'

  /*
   * CONFIRMED, not "sent".
   *
   * The old screen said "Sent to <shop>. They'll confirm it shortly" and drew
   * a three-step progress rail — an accurate description of LOT C, and now a
   * lie. The appointment is already booked; the server said so before this
   * component rendered. Showing progress for a finished state is the most
   * corrosive kind of fake affordance: it invents a wait that does not exist
   * and trains the customer to expect a message that will never come.
   */
  return (
    <div className="w-full rounded-2xl border border-border bg-paper-0 p-6 text-center shadow-xs">
      <motion.div
        // Meaningful, once, on the one screen in the flow that has earned it.
        // Transform and opacity only, so it composites; skipped entirely under
        // prefers-reduced-motion rather than merely shortened.
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-100"
      >
        <CalendarCheck2 className="h-7 w-7 text-success-700" aria-hidden="true" />
      </motion.div>

      {/* role=status so a screen reader announces the outcome without the
          user having to go looking for it. */}
      <h1 className="mt-4 text-balance text-xl font-semibold text-ink-950" role="status">
        {t('success.title')}
      </h1>
      <p className="mt-1 text-pretty text-sm text-ink-500">
        {t('success.subtitle', { organization: organization.name })}
      </p>

      <dl className="mt-6 flex flex-col gap-1.5 text-start text-sm">
        <SummaryRow label={t('success.service')} value={service.name} />
        <SummaryRow label={t('success.professional')} value={barber.displayName} />
        <SummaryRow label={t('success.date')} value={dt.longDate(appointment.startsAt, timeZone)} />
        <SummaryRow label={t('success.time')} value={dt.timeRange(appointment.startsAt, appointment.endsAt, timeZone)} />
        {location ? <SummaryRow label={t('success.location')} value={location.name} /> : null}
        <SummaryRow label={t('success.price')} value={money(service.priceCents, organization.currency)} />
      </dl>

      <Button
        type="button"
        variant="secondary"
        className="mt-4 w-full"
        onClick={() =>
          downloadIcs({
            uid: appointment.id,
            title: t('success.calendarTitle', { service: service.name, organization: organization.name }),
            description: t('success.calendarDescription', { professional: barber.displayName }),
            location: location?.name,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
          })
        }
      >
        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        {t('success.addToCalendar')}
      </Button>

      <SuccessNextStep hasClaimToken={Boolean(appointment.claimToken)} />
    </div>
  )
}

/**
 * The booking → account seam. A signed-in customer's appointment is already
 * linked server-side, so they just go look at it. An anonymous booker is
 * offered an account, and the claim token stashed at booking time is what
 * makes THIS appointment show up inside it — without that, creating an
 * account here would be an empty promise.
 */
function SuccessNextStep({ hasClaimToken }: { hasClaimToken: boolean }) {
  const { t } = useTranslation('booking')
  const { user } = useAuth()

  if (user) {
    return (
      <div className="mt-6 flex flex-col gap-2">
        <Link to="/app/customer/appointments" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
          {t('success.viewAppointment')}
        </Link>
        <Link to="/" className={buttonVariants({ variant: 'ghost' }, 'w-full')}>
          {t('success.done')}
        </Link>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      {hasClaimToken ? (
        <>
          <p className="text-pretty text-sm text-ink-500">{t('success.accountPrompt')}</p>
          <Link to="/register?redirect=%2Fapp%2Fcustomer" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
            {t('success.createAccount')}
          </Link>
          <Link to="/login?redirect=%2Fapp%2Fcustomer" className={buttonVariants({ variant: 'secondary' }, 'w-full')}>
            {t('success.haveAccount')}
          </Link>
        </>
      ) : null}
      <Link to="/" className={buttonVariants({ variant: 'ghost' }, 'w-full')}>
        {t('success.done')}
      </Link>
    </div>
  )
}

// --- shared step chrome -----------------------------------------------------

function StepShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink-950">{title}</h2>
      {children}
    </section>
  )
}

function StepError({ title, query }: { title: string; query: { error: Error | null; refetch: () => unknown } }) {
  const { t } = useTranslation('booking')
  return (
    <ErrorState
      title={title}
      description={query.error?.message ?? ''}
      action={
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('common:action.tryAgain')}
        </Button>
      }
    />
  )
}

/**
 * A real `<button>` styled as a row. Never a `Card` with an onClick — a div
 * that responds to a mouse and not to a keyboard is the most common way an
 * otherwise careful flow becomes unusable without one.
 */
function SelectableRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-16 w-full items-start gap-3 rounded-xl border border-border bg-paper-0 p-4 text-start',
        'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
        'hover:border-accent-300 hover:bg-accent-100/40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
      )}
    >
      {children}
    </button>
  )
}

function StepSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-3/4 rounded-xl" />
    </div>
  )
}
