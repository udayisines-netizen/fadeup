import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { useOrgChairs, type Chair } from '@/lib/queries/chairs'
import { useOrgServices, type Service } from '@/lib/queries/services'
import { useOrgServiceLocations, type ServiceLocation } from '@/lib/queries/service-locations'
import { useOrgBarberServices, type BarberService } from '@/lib/queries/barber-services'
import { useOrgBarbers, type Barber } from '@/lib/queries/barbers'
import { useOrgStaffProfiles, type StaffProfile } from '@/lib/queries/staff-profiles'
import {
  useApplyNoShowRule,
  useAvailableSlots,
  useCreateAppointment,
  useOrgAppointmentsForDate,
  useUpdateAppointmentStatus,
  type Appointment,
  type AppointmentStatus,
} from '@/lib/queries/appointments'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

// Distinct from the owner/manager MANAGING_ROLES used everywhere else in this
// app — appointments RLS also allows receptionist to write (see
// db/migrations/20260809140000_appointments.sql). Since LOT 11 phase 1, a
// barber can ALSO change status (not other fields) on an appointment
// assigned specifically to them — restricted server-side by trigger, see
// `isOwnBarber` below and the same pattern in app-queue-page.tsx.
const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

/**
 * Only the COLOUR lives in a constant. The words are translated at render —
 * a `Record<Status, string>` of English cannot be, which is how this page's
 * status vocabulary stayed English while every label around it was translated.
 */

const STATUS_BADGE_VARIANT: Record<AppointmentStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

const TERMINAL_STATUSES = new Set<AppointmentStatus>(['completed', 'cancelled', 'no_show'])

/** Valid staff-initiated status targets — 'pending' is never a target, only the public booking flow (LOT 9) creates pending appointments. */
const STATUS_TRANSITIONS: AppointmentStatus[] = ['confirmed', 'completed', 'cancelled', 'no_show']

const CONFLICT_CONSTRAINT_MARKERS = ['appointments_barber_no_overlap', 'appointments_chair_no_overlap']

function isBookingConflictError(error: unknown): boolean {
  const message = getErrorMessage(error) ?? ''
  return CONFLICT_CONSTRAINT_MARKERS.some((marker) => message.includes(marker))
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatTimeRange(startsAt: string, endsAt: string, timeZone: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone })
  return `${formatter.format(new Date(startsAt))}–${formatter.format(new Date(endsAt))}`
}

function formatTime(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function AppAppointmentsPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <AppointmentsSchedule organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function AppointmentsSchedule({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { user } = useAuth()
  const canManage = MANAGING_ROLES.has(role)
  const [selectedDate, setSelectedDate] = useState(todayIsoDate())
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [isBookingOpen, setIsBookingOpen] = useState(false)

  const locationsQuery = useOrgLocations(organizationId)
  const chairsQuery = useOrgChairs(organizationId)
  const servicesQuery = useOrgServices(organizationId)
  const serviceLocationsQuery = useOrgServiceLocations(organizationId)
  const barberServicesQuery = useOrgBarberServices(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const appointmentsQuery = useOrgAppointmentsForDate(organizationId, selectedDate)

  // No pg_cron in this stack yet (see 20260810100000_waitlist_and_no_show_rules.sql) —
  // opportunistically sweep overdue confirmed appointments to no_show once
  // whenever staff load the schedule. Safe to call from any role: RLS
  // scopes which rows it can actually touch.
  const applyNoShowRule = useApplyNoShowRule()
  useEffect(() => {
    if (organizationId) applyNoShowRule.mutate(organizationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  const locations = locationsQuery.data ?? []
  const activeLocationId = selectedLocationId ?? locations[0]?.id ?? null
  const activeLocation = locations.find((location) => location.id === activeLocationId) ?? null

  const isLoading =
    locationsQuery.isPending ||
    chairsQuery.isPending ||
    servicesQuery.isPending ||
    serviceLocationsQuery.isPending ||
    barberServicesQuery.isPending ||
    barbersQuery.isPending ||
    staffProfilesQuery.isPending ||
    appointmentsQuery.isPending

  const loadError =
    locationsQuery.error ??
    chairsQuery.error ??
    servicesQuery.error ??
    serviceLocationsQuery.error ??
    barberServicesQuery.error ??
    barbersQuery.error ??
    staffProfilesQuery.error ??
    appointmentsQuery.error

  const isError =
    locationsQuery.isError ||
    chairsQuery.isError ||
    servicesQuery.isError ||
    serviceLocationsQuery.isError ||
    barberServicesQuery.isError ||
    barbersQuery.isError ||
    staffProfilesQuery.isError ||
    appointmentsQuery.isError

  function refetchAll() {
    void locationsQuery.refetch()
    void chairsQuery.refetch()
    void servicesQuery.refetch()
    void serviceLocationsQuery.refetch()
    void barberServicesQuery.refetch()
    void barbersQuery.refetch()
    void staffProfilesQuery.refetch()
    void appointmentsQuery.refetch()
  }

  const staffProfileById = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfilesQuery.data ?? []) map.set(profile.id, profile)
    return map
  }, [staffProfilesQuery.data])

  const barberById = useMemo(() => {
    const map = new Map<string, Barber>()
    for (const barber of barbersQuery.data ?? []) map.set(barber.id, barber)
    return map
  }, [barbersQuery.data])

  const serviceById = useMemo(() => {
    const map = new Map<string, Service>()
    for (const service of servicesQuery.data ?? []) map.set(service.id, service)
    return map
  }, [servicesQuery.data])

  const chairById = useMemo(() => {
    const map = new Map<string, Chair>()
    for (const chair of chairsQuery.data ?? []) map.set(chair.id, chair)
    return map
  }, [chairsQuery.data])

  // "Is this appointment's barber_id me?" — same join-in-reverse pattern as
  // app-queue-page.tsx's isOwnBarber: my own staff_profiles row (matched on
  // auth user id), then my own barbers row (matched on that profile).
  const ownBarberId = useMemo(() => {
    if (!user) return null
    const ownProfile = (staffProfilesQuery.data ?? []).find((profile) => profile.userId === user.id)
    if (!ownProfile) return null
    const ownBarber = (barbersQuery.data ?? []).find((barber) => barber.staffProfileId === ownProfile.id)
    return ownBarber?.id ?? null
  }, [user, staffProfilesQuery.data, barbersQuery.data])

  function isOwnBarber(barberId: string): boolean {
    return barberId === ownBarberId
  }

  const appointmentsByLocation = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appointment of appointmentsQuery.data ?? []) {
      const list = map.get(appointment.locationId) ?? []
      list.push(appointment)
      map.set(appointment.locationId, list)
    }
    return map
  }, [appointmentsQuery.data])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('common:entity.schedule')}
        subtitle={t('app:appointments.theDaysAppointmentsForEachLocation')}
        actions={
          <div className="w-full sm:w-48">
            <TextField
              label={t('common:field.date')}
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </div>
        }
      />

      <div>
        {isLoading ? (
          <ScheduleSkeleton />
        ) : isError ? (
          <ErrorState
            title={t('app:appointments.couldntLoadTheSchedule')}
            description={loadError?.message}
            action={
              <Button variant="secondary" onClick={refetchAll}>
                {t('common:action.tryAgain')}
              </Button>
            }
          />
        ) : locations.length === 0 ? (
          <EmptyState
            title={t('app:appointments.noLocationsYet')}
            description={t('app:appointments.addALocationBeforeScheduling')}
            action={
              <Link to="/app/locations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                {t('app:appointments.goToLocations')}
              </Link>
            }
          />
        ) : (
          <Tabs value={activeLocationId ?? undefined} onValueChange={setSelectedLocationId}>
            <TabsList>
              {locations.map((location) => (
                <TabsTrigger key={location.id} value={location.id}>
                  {location.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {locations.map((location) => (
              <TabsContent key={location.id} value={location.id}>
                <LocationSchedule
                  location={location}
                  appointments={appointmentsByLocation.get(location.id) ?? []}
                  canManage={canManage}
                  isOwnBarber={isOwnBarber}
                  staffProfileById={staffProfileById}
                  barberById={barberById}
                  serviceById={serviceById}
                  chairById={chairById}
                  onNewAppointment={() => setIsBookingOpen(true)}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {isBookingOpen && activeLocation ? (
        <NewAppointmentDialog
          organizationId={organizationId}
          location={activeLocation}
          defaultDate={selectedDate}
          services={servicesQuery.data ?? []}
          serviceLocations={serviceLocationsQuery.data ?? []}
          barberServices={barberServicesQuery.data ?? []}
          barbers={barbersQuery.data ?? []}
          staffProfiles={staffProfilesQuery.data ?? []}
          onClose={() => setIsBookingOpen(false)}
          onBooked={() => {
            toast({ title: t('app:appointments.appointmentBooked'), variant: 'success' })
            setIsBookingOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

// --- Schedule list --------------------------------------------------------

function LocationSchedule({
  location,
  appointments,
  canManage,
  isOwnBarber,
  staffProfileById,
  barberById,
  serviceById,
  chairById,
  onNewAppointment,
}: {
  location: Location
  appointments: Appointment[]
  canManage: boolean
  isOwnBarber: (barberId: string) => boolean
  staffProfileById: Map<string, StaffProfile>
  barberById: Map<string, Barber>
  serviceById: Map<string, Service>
  chairById: Map<string, Chair>
  onNewAppointment: () => void
}) {
  const { t } = useTranslation()
  const showActionsColumn = canManage || appointments.some((appointment) => isOwnBarber(appointment.barberId))
  const columnCount = showActionsColumn ? 6 : 5

  function barberName(barberId: string): string {
    const staffProfileId = barberById.get(barberId)?.staffProfileId
    if (!staffProfileId) return t('app:waitlist.unassigned')
    return staffProfileById.get(staffProfileId)?.displayName ?? t('app:waitlist.unnamedProfessional')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={onNewAppointment}>
            {t('app:appointments.newAppointment')}
          </Button>
        ) : null}
      </div>
      <Table label={`Appointments at ${location.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common:field.time')}</TableHead>
            <TableHead>{t('common:entity.customer')}</TableHead>
            <TableHead>{t('common:entity.service')}</TableHead>
            <TableHead>{t('common:entity.barber')}</TableHead>
            <TableHead>{t('app:appointments.chair')}</TableHead>
            <TableHead>{t('common:field.status')}</TableHead>
            {showActionsColumn ? (
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.length === 0 ? (
            <TableStateRow colSpan={columnCount}>
              <EmptyState
                title={t('app:appointments.noAppointments')}
                description={
                  canManage
                    ? 'Nothing booked for this location on this date yet.'
                    : 'Nothing booked for this location on this date.'
                }
                action={
                  canManage ? (
                    <Button size="sm" onClick={onNewAppointment}>
                      {t('app:appointments.newAppointment')}
                    </Button>
                  ) : undefined
                }
                className="border-none"
              />
            </TableStateRow>
          ) : (
            appointments.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                location={location}
                canAct={canManage || isOwnBarber(appointment.barberId)}
                showActionsColumn={showActionsColumn}
                barberName={barberName(appointment.barberId)}
                serviceName={serviceById.get(appointment.serviceId)?.name ?? t('app:waitlist.unknownService')}
                chairName={appointment.chairId ? (chairById.get(appointment.chairId)?.name ?? '—') : '—'}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function AppointmentRow({
  appointment,
  location,
  canAct,
  showActionsColumn,
  barberName,
  serviceName,
  chairName,
}: {
  appointment: Appointment
  location: Location
  canAct: boolean
  showActionsColumn: boolean
  barberName: string
  serviceName: string
  chairName: string
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const updateStatus = useUpdateAppointmentStatus()
  const isTerminal = TERMINAL_STATUSES.has(appointment.status)

  function handleStatusChange(status: AppointmentStatus) {
    updateStatus.mutate(
      { id: appointment.id, organizationId: appointment.organizationId, status },
      {
        onSuccess: () => toast({ title: t('app:waitlist.markedAs', { status: t(`app:appointmentStatusShort.${status}`) }), variant: 'success' }),
        onError: (error) =>
          toast({
            title: t('app:appointments.couldntUpdateStatus'),
            description: getErrorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-medium text-ink-950">
        {formatTimeRange(appointment.startsAt, appointment.endsAt, location.timezone, i18n.language)}
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-ink-950">{appointment.customerName}</span>
          {appointment.customerPhone ? <span className="text-xs text-ink-500">{appointment.customerPhone}</span> : null}
          {appointment.customerEmail ? <span className="text-xs text-ink-500">{appointment.customerEmail}</span> : null}
        </div>
      </TableCell>
      <TableCell className="text-ink-500">{serviceName}</TableCell>
      <TableCell className="text-ink-500">{barberName}</TableCell>
      <TableCell className="text-ink-500">{chairName}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[appointment.status]}>{t(`app:appointmentStatusShort.${appointment.status}`)}</Badge>
      </TableCell>
      {showActionsColumn ? (
        <TableCell className="text-right">
          {canAct && !isTerminal ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" isLoading={updateStatus.isPending}>
                  {t('app:appointments.updateStatus')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STATUS_TRANSITIONS.filter((status) => status !== appointment.status).map((status) => (
                  <DropdownMenuItem
                    key={status}
                    variant={status === 'cancelled' || status === 'no_show' ? 'danger' : 'default'}
                    onSelect={() => handleStatusChange(status)}
                  >
                    {t('app:waitlist.markAs', { status: t(`app:appointmentStatusShort.${status}`) })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  )
}

// --- New appointment booking dialog ---------------------------------------

const bookingSchema = z.object({
  serviceId: z.string().min(1, 'Select a service'),
  barberId: z.string().min(1, 'Select a barber'),
  date: z.string().min(1, 'Select a date'),
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string(),
  customerEmail: z.string(),
  notes: z.string(),
})

type BookingFormValues = z.infer<typeof bookingSchema>

function NewAppointmentDialog({
  organizationId,
  location,
  defaultDate,
  services,
  serviceLocations,
  barberServices,
  barbers,
  staffProfiles,
  onClose,
  onBooked,
}: {
  organizationId: string
  location: Location
  defaultDate: string
  services: Service[]
  serviceLocations: ServiceLocation[]
  barberServices: BarberService[]
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  onClose: () => void
  onBooked: () => void
}) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const createAppointment = useCreateAppointment()
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<{ slotStart: string; slotEnd: string } | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      serviceId: '',
      barberId: '',
      date: defaultDate,
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      notes: '',
    },
  })

  const serviceId = watch('serviceId')
  const barberId = watch('barberId')
  const date = watch('date')

  const staffProfileById = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfiles) map.set(profile.id, profile)
    return map
  }, [staffProfiles])

  // Only services actually assigned to this location — never the full org catalog.
  const offeredServices = useMemo(() => {
    const offeredServiceIds = new Set(
      serviceLocations.filter((row) => row.locationId === location.id).map((row) => row.serviceId),
    )
    return services.filter((service) => service.isActive && offeredServiceIds.has(service.id))
  }, [services, serviceLocations, location.id])

  const selectedService = offeredServices.find((service) => service.id === serviceId) ?? null

  // Only barbers eligible for the selected service — never every bookable barber.
  const eligibleBarbers = useMemo(() => {
    const eligibleBarberIds = new Set(
      barberServices.filter((row) => row.serviceId === serviceId).map((row) => row.barberId),
    )
    return barbers.filter((barber) => barber.isBookable && eligibleBarberIds.has(barber.id))
  }, [barbers, barberServices, serviceId])

  // Changing the service can invalidate a previously-picked barber.
  useEffect(() => {
    if (barberId && !eligibleBarbers.some((barber) => barber.id === barberId)) {
      setValue('barberId', '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, eligibleBarbers])

  // Any change upstream of the slot picker makes the current selection stale.
  useEffect(() => {
    setSelectedSlot(null)
  }, [serviceId, barberId, date])

  const slotsQuery = useAvailableSlots(
    organizationId,
    location.id,
    barberId || undefined,
    serviceId || undefined,
    date || undefined,
  )

  async function onSubmit(values: BookingFormValues) {
    setFormError(null)

    if (!selectedService) {
      setFormError(t('app:appointments.selectAService'))
      return
    }
    if (!selectedSlot) {
      setFormError(t('app:appointments.pickAnAvailableTimeSlot'))
      return
    }

    try {
      await createAppointment.mutateAsync({
        organizationId,
        locationId: location.id,
        barberId: values.barberId,
        chairId: null,
        serviceId: values.serviceId,
        customerName: values.customerName.trim(),
        customerPhone: values.customerPhone.trim() || null,
        customerEmail: values.customerEmail.trim() || null,
        startsAt: selectedSlot.slotStart,
        endsAt: selectedSlot.slotEnd,
        bufferBeforeMinutes: selectedService.bufferBeforeMinutes,
        bufferAfterMinutes: selectedService.bufferAfterMinutes,
        status: 'confirmed',
        notes: values.notes.trim() || null,
        createdBy: user?.id ?? null,
      })
      onBooked()
    } catch (error) {
      if (isBookingConflictError(error)) {
        setFormError(t('app:appointments.thatTimeWasJustBooked'))
        setSelectedSlot(null)
        void slotsQuery.refetch()
        return
      }
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  const serviceOptions = [
    { value: '', label: offeredServices.length > 0 ? 'Select a service' : 'No services offered here yet' },
    ...offeredServices.map((service) => ({
      value: service.id,
      label: `${service.name} · ${service.durationMinutes} min`,
    })),
  ]

  const barberOptions = [
    {
      value: '',
      label: !serviceId
        ? 'Select a service first'
        : eligibleBarbers.length > 0
          ? 'Select a barber'
          : 'No barbers eligible for this service',
    },
    ...eligibleBarbers.map((barber) => ({
      value: barber.id,
      label: staffProfileById.get(barber.staffProfileId)?.displayName ?? t('app:waitlist.unnamedProfessional'),
    })),
  ]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('app:appointments.newAppointment')}</DialogTitle>
          <DialogDescription>
            Book a walk-in or phone request at {location.name}. It&apos;s created as confirmed.
          </DialogDescription>
        </DialogHeader>
        {/*
          Fields scroll, footer does not — see DialogBody. The old
          `max-h-[65vh]` scroller wrapped the footer too, so Cancel/Book were
          pushed below the window on short screens.
        */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="flex flex-col gap-4">
            {formError ? <Alert variant="error">{formError}</Alert> : null}

            {offeredServices.length === 0 ? (
              <Alert variant="info">
                No services are offered at {location.name} yet.{' '}
                <Link to="/app/services" className="underline">
                  {t('app:appointments.manageServices')}
                </Link>
                .
              </Alert>
            ) : (
              <>
                <SelectField label={t('common:entity.service')} options={serviceOptions} error={errors.serviceId?.message} {...register('serviceId')} />
                <SelectField
                  label={t('common:entity.barber')}
                  options={barberOptions}
                  disabled={!serviceId}
                  error={errors.barberId?.message}
                  {...register('barberId')}
                />
                <TextField label={t('common:field.date')} type="date" error={errors.date?.message} {...register('date')} />

                {serviceId && barberId && date ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink-950">{t('common:field.time')}</span>
                    {slotsQuery.isPending ? (
                      <Skeleton className="h-20 w-full" />
                    ) : slotsQuery.isError ? (
                      <Alert variant="error">{slotsQuery.error.message}</Alert>
                    ) : (slotsQuery.data ?? []).length === 0 ? (
                      <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-sm text-ink-500">
                        {t('app:appointments.noOpenSlotsThisDay')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {(slotsQuery.data ?? []).map((slot) => {
                          const isSelected = selectedSlot?.slotStart === slot.slotStart
                          return (
                            <button
                              key={slot.slotStart}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedSlot(slot)}
                              className={cn(
                                'min-h-9 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors',
                                isSelected
                                  ? 'border-accent-600 bg-accent-600 text-on-accent'
                                  : 'border-border-strong bg-paper-0 text-ink-800 hover:bg-paper-100',
                              )}
                            >
                              {formatTime(slot.slotStart, location.timezone, i18n.language)}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                <TextField label={t('common:field.customerName')} error={errors.customerName?.message} {...register('customerName')} />
                <div className="grid grid-cols-2 gap-4">
                  <TextField
                    label={t('common:field.phoneOptional')}
                    type="tel"
                    hint={t('app:appointments.atLeastAPhoneOr')}
                    {...register('customerPhone')}
                  />
                  <TextField label={t('common:field.emailOptional')} type="email" {...register('customerEmail')} />
                </div>
                <Textarea label={t('common:field.notesOptional')} rows={2} {...register('notes')} />
              </>
            )}

          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t('common:action.cancel')}
              </Button>
            </DialogClose>
            {offeredServices.length > 0 ? (
              <Button type="submit" isLoading={isSubmitting}>
                {t('app:appointments.bookAppointment')}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
