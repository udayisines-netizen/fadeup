import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, CalendarCheck2, CircleUserRound, MapPin } from 'lucide-react'
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
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { getErrorMessage } from '@/lib/get-error-message'

// --- small formatting helpers (page-local, mirrors the convention in app-services-page.tsx) ---

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr${hours > 1 ? 's' : ''}` : `${hours} hr ${rest} min`
}

function formatSlotTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
}

function formatSlotDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

function formatAddress(location: PublicLocation): string | null {
  const parts = [location.addressLine1, location.addressLine2, location.city, location.region, location.postalCode].filter(
    (part): part is string => Boolean(part),
  )
  return parts.length > 0 ? parts.join(', ') : null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/**
 * Turns the RPC's raw Postgres error message into user-facing copy.
 * Pattern-matches known substrings from `book_public_appointment`'s
 * `raise exception` calls and the GiST exclusion-constraint race message;
 * falls back to the raw message for anything unrecognized so a failure is
 * never silently swallowed.
 */
function friendlyBookingError(rawMessage: string): string {
  const message = rawMessage.toLowerCase()

  if (message.includes('exclusion') || message.includes('conflicting key value') || message.includes('duplicate key')) {
    return 'That time was just booked by someone else — please pick another time.'
  }
  if (message.includes('starts_at must be in the future')) {
    return 'That time has already passed — please choose another time.'
  }
  if (message.includes('outside available hours') || message.includes('closed at the requested time')) {
    return 'That time is no longer available — please choose another time.'
  }
  if (message.includes('unavailable on the requested date') || message.includes('does not work on the requested date')) {
    return "This barber isn't available on that date — please choose another time."
  }
  if (message.includes('at least one of customer_phone or customer_email')) {
    return 'Please provide a phone number or email so the shop can reach you.'
  }
  if (message.includes('customer_name is required')) {
    return 'Please enter your name.'
  }
  if (message.includes('location is not available for booking')) {
    return "This location isn't available for booking right now."
  }
  if (message.includes('service is not available for booking')) {
    return "This service isn't available for booking at this location."
  }
  if (message.includes('barber is not available for this service')) {
    return "This barber isn't available for this service — please choose another barber."
  }

  return rawMessage
}

// --- top-level route component --------------------------------------------------------

export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)

  useDocumentMeta({
    title: organizationQuery.data ? `Book with ${organizationQuery.data.name} — FadeUp` : 'Book an appointment — FadeUp',
    description: organizationQuery.data
      ? `Book an appointment with ${organizationQuery.data.name} in minutes.`
      : 'Book a barbershop appointment in minutes.',
  })

  if (organizationQuery.isPending) {
    return <PageSpinner label="Loading booking page…" />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title="Couldn't load this booking page"
          description={organizationQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void organizationQuery.refetch()}>
              Try again
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
          title="We couldn't find this shop"
          description="This booking link may be out of date, or the web address may have changed. Check the link with the shop directly."
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              Go to FadeUp
            </Link>
          }
        />
      </Container>
    )
  }

  return <BookingWizard organization={organizationQuery.data} />
}

/**
 * Reads `?barber=<id>` (optionally `&location=<id>`) — set by marketplace
 * result cards and the Barber Passport page's "Book with <name>" link — so
 * arriving with a specific barber already in mind preserves that choice
 * instead of making the customer re-pick from scratch (spec: "entering
 * booking from a barber preserves barber selection"). Best-effort by
 * design: the wizard's step order is location -> service -> barber (barber
 * eligibility depends on the chosen service), so a barber can only be
 * pre-applied once the customer reaches the barber step for a service that
 * barber actually offers — see BookingWizard's effects below. This
 * preserves the existing, working step machine rather than restructuring
 * it around a barber-first flow.
 */
function usePreselection() {
  const [searchParams] = useSearchParams()
  return {
    preselectedBarberId: searchParams.get('barber'),
    preselectedLocationId: searchParams.get('location'),
    preselectedServiceId: searchParams.get('service'),
  }
}

// --- step model ------------------------------------------------------------------------

type Phase = 'location' | 'service' | 'barber' | 'datetime' | 'details' | 'success'

interface SlotSelection {
  slotStart: string
  slotEnd: string
}

function BookingWizard({ organization }: { organization: PublicOrganization }) {
  const locationsQuery = usePublicLocations(organization.slug)
  const { preselectedBarberId, preselectedLocationId, preselectedServiceId } = usePreselection()

  const [phase, setPhase] = useState<Phase>('location')
  const [history, setHistory] = useState<Phase[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [barberId, setBarberId] = useState<string | null>(null)
  const [date, setDate] = useState<string>(todayIsoDate())
  const [slot, setSlot] = useState<SlotSelection | null>(null)
  const [bookingResult, setBookingResult] = useState<BookedAppointment | null>(null)

  const servicesQuery = usePublicServices(organization.slug, locationId ?? undefined)
  const barbersQuery = usePublicBarbers(organization.slug, locationId ?? undefined, serviceId ?? undefined)
  const slotsQuery = usePublicAvailableSlots(organization.slug, locationId ?? undefined, barberId ?? undefined, serviceId ?? undefined, date)

  // Skip the location step when a specific location was preselected (from a
  // barber's own profile) or the shop has just one — don't make a customer
  // tap through a step with only one possible/already-decided answer.
  useEffect(() => {
    if (locationId || !locationsQuery.data) return
    if (preselectedLocationId && locationsQuery.data.some((location) => location.id === preselectedLocationId)) {
      setLocationId(preselectedLocationId)
      setPhase('service')
      return
    }
    if (!preselectedLocationId && locationsQuery.data.length === 1) {
      setLocationId(locationsQuery.data[0]!.id)
      setPhase('service')
    }
  }, [locationsQuery.data, locationId, preselectedLocationId])

  // Same idea for a preselected service (from a "Rebook" link) — skip
  // straight to the barber step once it's confirmed to actually be offered
  // at the (now-known) location.
  useEffect(() => {
    if (!locationId || serviceId || phase !== 'service' || !preselectedServiceId || !servicesQuery.data) return
    if (servicesQuery.data.some((service) => service.id === preselectedServiceId)) {
      setServiceId(preselectedServiceId)
      setPhase('barber')
    }
  }, [servicesQuery.data, locationId, serviceId, phase, preselectedServiceId])

  // Same idea for a service with exactly one eligible barber, OR the
  // preselected barber turns out to be eligible for the chosen service.
  useEffect(() => {
    if (!serviceId || barberId || phase !== 'barber' || !barbersQuery.data) return
    if (preselectedBarberId && barbersQuery.data.some((barber) => barber.barberId === preselectedBarberId)) {
      setBarberId(preselectedBarberId)
      setPhase('datetime')
      return
    }
    if (barbersQuery.data.length === 1) {
      setBarberId(barbersQuery.data[0]!.barberId)
      setPhase('datetime')
    }
  }, [barbersQuery.data, serviceId, barberId, phase, preselectedBarberId])

  function goTo(next: Phase) {
    setHistory((prev) => [...prev, phase])
    setPhase(next)
  }

  function goBack() {
    setHistory((prev) => {
      if (prev.length === 0) return prev
      setPhase(prev[prev.length - 1]!)
      return prev.slice(0, -1)
    })
  }

  const selectedLocation = useMemo(
    () => locationsQuery.data?.find((location) => location.id === locationId) ?? null,
    [locationsQuery.data, locationId],
  )
  const selectedService = useMemo(
    () => servicesQuery.data?.find((service) => service.id === serviceId) ?? null,
    [servicesQuery.data, serviceId],
  )
  const selectedBarber = useMemo(
    () => barbersQuery.data?.find((barber) => barber.barberId === barberId) ?? null,
    [barbersQuery.data, barberId],
  )

  function handleSelectLocation(id: string) {
    setLocationId(id)
    setServiceId(null)
    setBarberId(null)
    setSlot(null)
    goTo('service')
  }

  function handleSelectService(id: string) {
    setServiceId(id)
    setBarberId(null)
    setSlot(null)
    goTo('barber')
  }

  function handleSelectBarber(id: string) {
    setBarberId(id)
    setSlot(null)
    goTo('datetime')
  }

  function handleSelectSlot(next: SlotSelection) {
    setSlot(next)
    goTo('details')
  }

  const canGoBack = history.length > 0

  if (phase === 'success' && bookingResult && selectedService && selectedBarber) {
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
    <Container size="sm" className="flex flex-1 flex-col py-6 sm:py-10">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Book an appointment</p>
        <h1 className="mt-1 text-2xl font-semibold text-balance text-ink-950">{organization.name}</h1>
      </div>

      {canGoBack ? (
        <button
          type="button"
          onClick={goBack}
          className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-700 hover:text-ink-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
      ) : null}

      {phase === 'location' ? (
        <LocationStep query={locationsQuery} onSelect={handleSelectLocation} />
      ) : null}

      {phase === 'service' ? (
        <ServiceStep query={servicesQuery} onSelect={handleSelectService} />
      ) : null}

      {phase === 'barber' ? <BarberStep query={barbersQuery} onSelect={handleSelectBarber} /> : null}

      {phase === 'datetime' && selectedLocation ? (
        <DateTimeStep
          query={slotsQuery}
          location={selectedLocation}
          date={date}
          selectedSlot={slot}
          onChangeDate={(next) => {
            setDate(next)
            setSlot(null)
          }}
          onSelectSlot={handleSelectSlot}
        />
      ) : null}

      {phase === 'details' && selectedService && selectedBarber && slot ? (
        <DetailsStep
          organization={organization}
          location={selectedLocation}
          service={selectedService}
          barber={selectedBarber}
          slot={slot}
          onSuccess={(appointment) => {
            setBookingResult(appointment)
            setPhase('success')
          }}
        />
      ) : null}
    </Container>
  )
}

// --- step: location ----------------------------------------------------------------

function LocationStep({
  query,
  onSelect,
}: {
  query: ReturnType<typeof usePublicLocations>
  onSelect: (id: string) => void
}) {
  return (
    <StepShell title="Choose a location">
      {query.isPending ? (
        <StepSkeleton />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load locations"
          description={query.error.message}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : query.data.length === 0 ? (
        <EmptyState title="No locations available" description="This shop doesn't have any locations open for booking right now." />
      ) : (
        <div className="flex flex-col gap-3">
          {query.data.map((location) => (
            <SelectableCard key={location.id} onClick={() => onSelect(location.id)}>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium text-ink-950">{location.name}</p>
                  {formatAddress(location) ? <p className="mt-0.5 text-sm text-ink-500">{formatAddress(location)}</p> : null}
                </div>
              </div>
            </SelectableCard>
          ))}
        </div>
      )}
    </StepShell>
  )
}

// --- step: service -------------------------------------------------------------------

function ServiceStep({
  query,
  onSelect,
}: {
  query: ReturnType<typeof usePublicServices>
  onSelect: (id: string) => void
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, PublicService[]>()
    for (const service of query.data ?? []) {
      const key = service.categoryName ?? 'Services'
      const bucket = groups.get(key) ?? []
      bucket.push(service)
      groups.set(key, bucket)
    }
    return groups
  }, [query.data])

  return (
    <StepShell title="Choose a service">
      {query.isPending ? (
        <StepSkeleton />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load services"
          description={query.error.message}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState title="No services available" description="This location doesn't have any bookable services right now." />
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(grouped.entries()).map(([categoryName, services]) => (
            <div key={categoryName}>
              <h2 className="mb-2 text-sm font-semibold text-ink-950">{categoryName}</h2>
              <div className="flex flex-col gap-3">
                {services.map((service) => (
                  <SelectableCard key={service.id} onClick={() => onSelect(service.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-950">{service.name}</p>
                        {service.description ? <p className="mt-0.5 text-sm text-ink-500">{service.description}</p> : null}
                        <p className="mt-1 text-xs text-ink-500">{formatDuration(service.durationMinutes)}</p>
                      </div>
                      <span className="shrink-0 font-medium text-ink-950">{formatPrice(service.priceCents)}</span>
                    </div>
                  </SelectableCard>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </StepShell>
  )
}

// --- step: barber ---------------------------------------------------------------------

function BarberStep({
  query,
  onSelect,
}: {
  query: ReturnType<typeof usePublicBarbers>
  onSelect: (id: string) => void
}) {
  return (
    <StepShell title="Choose a barber">
      {query.isPending ? (
        <StepSkeleton />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load barbers"
          description={query.error.message}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : query.data.length === 0 ? (
        <EmptyState title="No barbers available" description="No one is currently bookable for this service. Try a different service." />
      ) : (
        <div className="flex flex-col gap-3">
          {query.data.map((barber) => (
            <SelectableCard key={barber.barberId} onClick={() => onSelect(barber.barberId)}>
              <div className="flex items-start gap-3">
                <BarberAvatar name={barber.displayName} avatarUrl={barber.avatarUrl} />
                <div className="min-w-0">
                  <p className="font-medium text-ink-950">{barber.displayName}</p>
                  {barber.title ? <p className="text-sm text-ink-500">{barber.title}</p> : null}
                  {barber.bio ? <p className="mt-1 text-sm text-ink-500">{barber.bio}</p> : null}
                </div>
              </div>
            </SelectableCard>
          ))}
        </div>
      )}
    </StepShell>
  )
}

function BarberAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800">
      {initialsOf(name)}
    </span>
  )
}

// --- step: date + time ------------------------------------------------------------------

function DateTimeStep({
  query,
  location,
  date,
  selectedSlot,
  onChangeDate,
  onSelectSlot,
}: {
  query: ReturnType<typeof usePublicAvailableSlots>
  location: PublicLocation
  date: string
  selectedSlot: SlotSelection | null
  onChangeDate: (date: string) => void
  onSelectSlot: (slot: SlotSelection) => void
}) {
  return (
    <StepShell title="Choose a date & time">
      <TextField
        label="Date"
        type="date"
        min={todayIsoDate()}
        value={date}
        onChange={(event) => onChangeDate(event.target.value)}
      />

      <div className="mt-4">
        {query.isPending ? (
          <StepSkeleton />
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load available times"
            description={query.error.message}
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          />
        ) : query.data.length === 0 ? (
          <EmptyState title="No times available on this day" description="Try a different date — this barber has no open slots on the selected day." />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {query.data.map((availableSlot) => {
              const isSelected = selectedSlot?.slotStart === availableSlot.slotStart
              return (
                <button
                  key={availableSlot.slotStart}
                  type="button"
                  onClick={() => onSelectSlot({ slotStart: availableSlot.slotStart, slotEnd: availableSlot.slotEnd })}
                  className={
                    isSelected
                      ? 'min-h-11 rounded-md border border-accent-600 bg-accent-100 px-2 py-2 text-sm font-medium text-accent-800'
                      : 'min-h-11 rounded-md border border-border-strong bg-paper-0 px-2 py-2 text-sm font-medium text-ink-800 hover:bg-paper-100'
                  }
                >
                  {formatSlotTime(availableSlot.slotStart, location.timezone)}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </StepShell>
  )
}

// --- step: details + confirm ------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const detailsSchema = z
  .object({
    customerName: z.string().trim().min(1, 'Name is required'),
    customerPhone: z.string().trim(),
    customerEmail: z.string().trim(),
    notes: z.string().trim(),
  })
  .refine((values) => values.customerPhone !== '' || values.customerEmail !== '', {
    message: 'Enter a phone number or email so the shop can reach you',
    path: ['customerPhone'],
  })
  .refine((values) => values.customerEmail === '' || EMAIL_PATTERN.test(values.customerEmail), {
    message: 'Enter a valid email address',
    path: ['customerEmail'],
  })

type DetailsFormValues = z.infer<typeof detailsSchema>

function DetailsStep({
  organization,
  location,
  service,
  barber,
  slot,
  onSuccess,
}: {
  organization: PublicOrganization
  location: PublicLocation | null
  service: PublicService
  barber: PublicBarber
  slot: SlotSelection
  onSuccess: (appointment: BookedAppointment) => void
}) {
  const bookAppointment = useBookPublicAppointment()
  const { user } = useAuth()
  const myProfile = useMyCustomerProfile(user?.id)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
  // in once, from their own saved profile, and only fields that profile
  // actually has — never invents a value, and never clobbers typing (the
  // ref makes this strictly first-arrival).
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
    setSubmitError(null)
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
      // Anonymous booking: hold on to the one-time claim token so that, if
      // the customer creates an account from the success screen, this
      // booking follows them into it. A signed-in booking returns no token
      // — the server already linked it (see the migration).
      if (!user && appointment.claimToken) {
        storePendingClaimToken(appointment.claimToken)
      }
      onSuccess(appointment)
    } catch (error) {
      const rawMessage = getErrorMessage(error) ?? 'Something went wrong. Please try again.'
      setSubmitError(friendlyBookingError(rawMessage))
    }
  }

  return (
    <StepShell title="Your details">
      <Card className="mb-5 p-4">
        <dl className="flex flex-col gap-1.5 text-sm">
          <SummaryRow label="Shop" value={organization.name} />
          {location ? <SummaryRow label="Location" value={location.name} /> : null}
          <SummaryRow label="Service" value={`${service.name} · ${formatDuration(service.durationMinutes)}`} />
          <SummaryRow label="Barber" value={barber.displayName} />
          <SummaryRow label="When" value={formatSlotDateTime(slot.slotStart, location?.timezone ?? 'UTC')} />
          <SummaryRow label="Price" value={formatPrice(service.priceCents)} />
        </dl>
      </Card>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {submitError ? <Alert variant="error">{submitError}</Alert> : null}

        <TextField label="Full name" autoComplete="name" error={errors.customerName?.message} {...register('customerName')} />
        <TextField
          label="Phone number"
          type="tel"
          autoComplete="tel"
          hint="Provide a phone number or email so the shop can reach you"
          error={errors.customerPhone?.message}
          {...register('customerPhone')}
        />
        <TextField label="Email" type="email" autoComplete="email" error={errors.customerEmail?.message} {...register('customerEmail')} />
        <Textarea label="Notes (optional)" rows={3} {...register('notes')} />

        <Button type="submit" size="lg" isLoading={isSubmitting} className="mt-2">
          Request appointment
        </Button>
        <p className="text-xs text-ink-500">
          This sends a request — the shop will confirm your appointment shortly, it isn&apos;t booked instantly.
        </p>
      </form>
    </StepShell>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-950">{value}</dd>
    </div>
  )
}

// --- success screen ----------------------------------------------------------------------

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
  return (
    <Card elevated className="w-full p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-100">
        <CalendarCheck2 className="h-6 w-6 text-success-700" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-ink-950">Request sent</h1>
      <p className="mt-1 text-sm text-ink-500">
        Your appointment request has been sent to {organization.name} — they&apos;ll confirm it shortly.
      </p>

      <div className="mt-6 flex justify-center">
        <Badge variant="warning">Pending confirmation</Badge>
      </div>

      <dl className="mt-6 flex flex-col gap-1.5 text-left text-sm">
        <SummaryRow label="Service" value={service.name} />
        <SummaryRow label="Barber" value={barber.displayName} />
        <SummaryRow label="When" value={formatSlotDateTime(appointment.startsAt, location?.timezone ?? 'UTC')} />
        {location ? <SummaryRow label="Location" value={location.name} /> : null}
      </dl>

      <SuccessNextStep hasClaimToken={Boolean(appointment.claimToken)} />
    </Card>
  )
}

/**
 * The booking -> account seam. A signed-in customer's appointment is
 * already linked server-side, so they just go look at it. An anonymous
 * booker is offered an account, and the claim token stashed at booking
 * time is what makes THIS appointment show up inside it — without that
 * step, creating an account here would be an empty promise.
 */
function SuccessNextStep({ hasClaimToken }: { hasClaimToken: boolean }) {
  const { user } = useAuth()

  if (user) {
    return (
      <div className="mt-6 flex flex-col gap-2">
        <Link to="/app/customer/appointments" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
          View my appointments
        </Link>
        <Link to="/" className={buttonVariants({ variant: 'ghost' }, 'w-full')}>
          Done
        </Link>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      {hasClaimToken ? (
        <>
          <p className="text-sm text-ink-500">
            Create an account to track this appointment, rebook in one tap, and keep your Fade Passport.
          </p>
          <Link
            to="/register?redirect=%2Fapp%2Fcustomer"
            className={buttonVariants({ variant: 'primary' }, 'w-full')}
          >
            Create an account
          </Link>
          <Link
            to="/login?redirect=%2Fapp%2Fcustomer"
            className={buttonVariants({ variant: 'secondary' }, 'w-full')}
          >
            I already have an account
          </Link>
        </>
      ) : null}
      <Link to="/" className={buttonVariants({ variant: 'ghost' }, 'w-full')}>
        Done
      </Link>
    </div>
  )
}

// --- shared step chrome ------------------------------------------------------------------

function StepShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink-950">
        <CircleUserRound className="hidden h-5 w-5 text-accent-600" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </div>
  )
}

/** Card-styled, fully native `<button>` (never nest interactive elements inside `Card`, which renders a `<div>`). */
function SelectableCard({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 w-full rounded-lg border border-border-strong bg-paper-0 p-4 text-left transition-colors hover:border-accent-600 hover:bg-accent-100/30 focus-visible:outline-2 focus-visible:outline-accent-600"
    >
      {children}
    </button>
  )
}

function StepSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-3/4" />
    </div>
  )
}
