import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { useOrgLocationHours, useUpsertLocationHours, type LocationHours } from '@/lib/queries/location-hours'
import { useOrgBarbers, type Barber } from '@/lib/queries/barbers'
import { useOrgStaffProfiles, type StaffProfile } from '@/lib/queries/staff-profiles'
import {
  useOrgBarberWorkingHours,
  useUpsertBarberWorkingHours,
  type BarberWorkingHours,
} from '@/lib/queries/barber-working-hours'
import {
  useBarberAvailabilityExceptions,
  useCreateBarberAvailabilityException,
  useDeleteBarberAvailabilityException,
  type BarberAvailabilityException,
} from '@/lib/queries/barber-availability-exceptions'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Switch } from '@/components/ui/switch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { cn } from '@/lib/cn'
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Shared shape for a single weekly-hours row, whether it's location or barber hours. */
interface WeeklyDayValue {
  dayOfWeek: number
  closed: boolean
  startTime: string | null
  endTime: string | null
  /**
   * The afternoon half of a split shift. Both null means one continuous
   * window, which is how every day behaved before LOT D and still does unless
   * someone turns the break on.
   */
  secondStartTime: string | null
  secondEndTime: string | null
}

function toTimeInputValue(value: string | null): string {
  return value ? value.slice(0, 5) : ''
}

/** Every day of the week 0..6, defaulting to closed for days with no stored row (the DB's own convention). */
function buildWeek(byDay: Map<number, WeeklyDayValue>): WeeklyDayValue[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) =>
    byDay.get(dayOfWeek) ?? {
      dayOfWeek,
      closed: true,
      startTime: null,
      endTime: null,
      secondStartTime: null,
      secondEndTime: null,
    },
  )
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function AppAvailabilityPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <AvailabilityManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function AvailabilityManagement({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const canManage = MANAGING_ROLES.has(role)
  const locationsQuery = useOrgLocations(organizationId)
  const locationHoursQuery = useOrgLocationHours(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const barberWorkingHoursQuery = useOrgBarberWorkingHours(organizationId)

  const isLoading =
    locationsQuery.isPending ||
    locationHoursQuery.isPending ||
    barbersQuery.isPending ||
    staffProfilesQuery.isPending ||
    barberWorkingHoursQuery.isPending

  const loadError =
    locationsQuery.error ?? locationHoursQuery.error ?? barbersQuery.error ?? staffProfilesQuery.error ?? barberWorkingHoursQuery.error

  const isError =
    locationsQuery.isError ||
    locationHoursQuery.isError ||
    barbersQuery.isError ||
    staffProfilesQuery.isError ||
    barberWorkingHoursQuery.isError

  function refetchAll() {
    void locationsQuery.refetch()
    void locationHoursQuery.refetch()
    void barbersQuery.refetch()
    void staffProfilesQuery.refetch()
    void barberWorkingHoursQuery.refetch()
  }

  return (
    <Container size="lg" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Availability</h1>
        <p className="mt-1 text-sm text-ink-500">Weekly hours for each location and barber, plus one-off time off.</p>
      </div>

      {isLoading ? (
        <div className="mt-6">
          <AvailabilitySkeleton />
        </div>
      ) : isError ? (
        <div className="mt-6">
          <ErrorState
            title="Couldn't load availability"
            description={loadError?.message}
            action={
              <Button variant="secondary" onClick={refetchAll}>
                Try again
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <LocationHoursSection
            organizationId={organizationId}
            locations={locationsQuery.data}
            hours={locationHoursQuery.data}
            canManage={canManage}
          />
          <BarberAvailabilitySection
            organizationId={organizationId}
            barbers={barbersQuery.data}
            staffProfiles={staffProfilesQuery.data}
            workingHours={barberWorkingHoursQuery.data}
            canManage={canManage}
          />
        </>
      )}
    </Container>
  )
}

// --- Location hours -----------------------------------------------------------

function LocationHoursSection({
  organizationId,
  locations,
  hours,
  canManage,
}: {
  organizationId: string
  locations: Location[]
  hours: LocationHours[]
  canManage: boolean
}) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const upsertHours = useUpsertLocationHours()

  const activeLocationId = selectedLocationId ?? locations[0]?.id ?? null

  const hoursByLocation = useMemo(() => {
    const map = new Map<string, Map<number, WeeklyDayValue>>()
    for (const row of hours) {
      const dayMap = map.get(row.locationId) ?? new Map<number, WeeklyDayValue>()
      dayMap.set(row.dayOfWeek, {
        dayOfWeek: row.dayOfWeek,
        closed: row.isClosed,
        startTime: row.openTime,
        endTime: row.closeTime,
        secondStartTime: row.secondOpenTime,
        secondEndTime: row.secondCloseTime,
      })
      map.set(row.locationId, dayMap)
    }
    return map
  }, [hours])

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink-950">Location hours</h2>
      <div className="mt-3">
        {locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            description="Add a location before setting its hours."
            action={
              <Link to="/app/locations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                Go to locations
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
                <WeeklyHoursTable
                  days={buildWeek(hoursByLocation.get(location.id) ?? new Map())}
                  canManage={canManage}
                  closedLabel="Closed"
                  onSave={(value) =>
                    upsertHours.mutateAsync({
                      organizationId,
                      locationId: location.id,
                      dayOfWeek: value.dayOfWeek,
                      isClosed: value.closed,
                      openTime: value.startTime,
                      closeTime: value.endTime,
                      secondOpenTime: value.secondStartTime,
                      secondCloseTime: value.secondEndTime,
                    })
                  }
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </section>
  )
}

// --- Barber hours + exceptions -------------------------------------------------

function BarberAvailabilitySection({
  organizationId,
  barbers,
  staffProfiles,
  workingHours,
  canManage,
}: {
  organizationId: string
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  workingHours: BarberWorkingHours[]
  canManage: boolean
}) {
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null)
  const upsertHours = useUpsertBarberWorkingHours()

  const bookableBarbers = useMemo(() => barbers.filter((barber) => barber.isBookable), [barbers])

  const staffProfileById = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfiles) map.set(profile.id, profile)
    return map
  }, [staffProfiles])

  const activeBarberId = selectedBarberId ?? bookableBarbers[0]?.id ?? null

  const hoursByBarber = useMemo(() => {
    const map = new Map<string, Map<number, WeeklyDayValue>>()
    for (const row of workingHours) {
      const dayMap = map.get(row.barberId) ?? new Map<number, WeeklyDayValue>()
      dayMap.set(row.dayOfWeek, {
        dayOfWeek: row.dayOfWeek,
        closed: row.isOff,
        startTime: row.startTime,
        endTime: row.endTime,
        secondStartTime: row.secondStartTime,
        secondEndTime: row.secondEndTime,
      })
      map.set(row.barberId, dayMap)
    }
    return map
  }, [workingHours])

  const barberOptions = bookableBarbers.map((barber) => ({
    value: barber.id,
    label: staffProfileById.get(barber.staffProfileId)?.displayName ?? 'Unnamed barber',
  }))

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink-950">Barber hours &amp; time off</h2>
      <div className="mt-3">
        {bookableBarbers.length === 0 ? (
          <EmptyState
            title="No bookable barbers yet"
            description="Mark a team member as a bookable barber to set their schedule."
            action={
              <Link to="/app/team" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                Go to team
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="sm:w-64">
              <SelectField
                label="Barber"
                options={barberOptions}
                value={activeBarberId ?? undefined}
                onChange={(event) => setSelectedBarberId(event.target.value)}
              />
            </div>

            {activeBarberId ? (
              <>
                <WeeklyHoursTable
                  key={`hours-${activeBarberId}`}
                  days={buildWeek(hoursByBarber.get(activeBarberId) ?? new Map())}
                  canManage={canManage}
                  closedLabel="Off"
                  onSave={(value) =>
                    upsertHours.mutateAsync({
                      organizationId,
                      barberId: activeBarberId,
                      dayOfWeek: value.dayOfWeek,
                      isOff: value.closed,
                      startTime: value.startTime,
                      endTime: value.endTime,
                      secondStartTime: value.secondStartTime,
                      secondEndTime: value.secondEndTime,
                    })
                  }
                />
                <ExceptionsSection
                  key={`exceptions-${activeBarberId}`}
                  organizationId={organizationId}
                  barberId={activeBarberId}
                  canManage={canManage}
                />
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

// --- Shared weekly hours table --------------------------------------------------

function WeeklyHoursTable({
  days,
  canManage,
  closedLabel,
  onSave,
}: {
  days: WeeklyDayValue[]
  canManage: boolean
  closedLabel: string
  onSave: (value: WeeklyDayValue) => Promise<void>
}) {
  return (
    <Table label="Weekly hours">
      <TableHeader>
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead>{closedLabel}</TableHead>
          <TableHead>Break</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          {canManage ? (
            <TableHead>
              <span className="sr-only">Save</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((day) => (
          <WeeklyHoursRow key={day.dayOfWeek} day={day} canManage={canManage} closedLabel={closedLabel} onSave={onSave} />
        ))}
      </TableBody>
    </Table>
  )
}

const TIME_INPUT_CLASSES = cn(
  'min-h-9 rounded-md border border-border-strong bg-paper-0 px-2 py-1 text-sm text-ink-950',
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-paper-100 disabled:text-ink-300',
)

function WeeklyHoursRow({
  day,
  canManage,
  closedLabel,
  onSave,
}: {
  day: WeeklyDayValue
  canManage: boolean
  closedLabel: string
  onSave: (value: WeeklyDayValue) => Promise<void>
}) {
  const { toast } = useToast()
  const dayLabel = DAY_LABELS[day.dayOfWeek] ?? `Day ${day.dayOfWeek}`
  const initialStart = toTimeInputValue(day.startTime)
  const initialEnd = toTimeInputValue(day.endTime)
  const initialSecondStart = toTimeInputValue(day.secondStartTime)
  const initialSecondEnd = toTimeInputValue(day.secondEndTime)
  const initialSplit = Boolean(day.secondStartTime && day.secondEndTime)

  const [closed, setClosed] = useState(day.closed)
  const [startTime, setStartTime] = useState(initialStart)
  const [endTime, setEndTime] = useState(initialEnd)
  const [split, setSplit] = useState(initialSplit)
  const [secondStartTime, setSecondStartTime] = useState(initialSecondStart)
  const [secondEndTime, setSecondEndTime] = useState(initialSecondEnd)
  const [isSaving, setIsSaving] = useState(false)

  const isDirty =
    closed !== day.closed ||
    startTime !== initialStart ||
    endTime !== initialEnd ||
    split !== initialSplit ||
    (split && (secondStartTime !== initialSecondStart || secondEndTime !== initialSecondEnd))

  // Mirrors the CHECK constraint and apply_weekly_hours' own validation, so
  // the person gets a sentence here instead of a constraint name from Postgres.
  const firstInvalid = !closed && (!startTime || !endTime || startTime >= endTime)
  const secondInvalid =
    !closed &&
    split &&
    (!secondStartTime || !secondEndTime || secondStartTime >= secondEndTime || secondStartTime < endTime)
  const isInvalid = firstInvalid || secondInvalid

  async function handleSave() {
    setIsSaving(true)
    try {
      await onSave({
        dayOfWeek: day.dayOfWeek,
        closed,
        startTime: closed ? null : startTime,
        endTime: closed ? null : endTime,
        // A closed day, or one without a break, carries no second interval —
        // sent explicitly as null so turning the break off actually clears it.
        secondStartTime: closed || !split ? null : secondStartTime,
        secondEndTime: closed || !split ? null : secondEndTime,
      })
      toast({ title: `${dayLabel} updated`, variant: 'success' })
    } catch (error) {
      toast({
        title: "Couldn't save hours",
        description: getErrorMessage(error),
        variant: 'error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-medium text-ink-950">{dayLabel}</TableCell>
      <TableCell>
        <Switch
          label={`${dayLabel} ${closedLabel.toLowerCase()}`}
          hideLabel
          checked={closed}
          disabled={!canManage}
          onChange={(event) => setClosed(event.target.checked)}
        />
      </TableCell>
      <TableCell>
        {/* A midday closure is how most salons actually work, and until LOT D
            the schema could not express it at all — one interval per day. */}
        <Switch
          label={`${dayLabel} has a midday break`}
          hideLabel
          checked={split}
          disabled={closed || !canManage}
          onChange={(event) => {
            const next = event.target.checked
            setSplit(next)
            if (next && !secondStartTime && !secondEndTime) {
              // Sensible opening guess, so nobody types four times from scratch.
              setSecondStartTime(endTime || '14:00')
              setSecondEndTime('19:00')
            }
          }}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <input
            type="time"
            aria-label={`${dayLabel} start time`}
            className={TIME_INPUT_CLASSES}
            value={startTime}
            disabled={closed || !canManage}
            onChange={(event) => setStartTime(event.target.value)}
          />
          {split && !closed ? (
            <input
              type="time"
              aria-label={`${dayLabel} afternoon start time`}
              className={TIME_INPUT_CLASSES}
              value={secondStartTime}
              disabled={!canManage}
              onChange={(event) => setSecondStartTime(event.target.value)}
            />
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <input
            type="time"
            aria-label={`${dayLabel} end time`}
            className={TIME_INPUT_CLASSES}
            value={endTime}
            disabled={closed || !canManage}
            onChange={(event) => setEndTime(event.target.value)}
          />
          {split && !closed ? (
            <input
              type="time"
              aria-label={`${dayLabel} afternoon end time`}
              className={TIME_INPUT_CLASSES}
              value={secondEndTime}
              disabled={!canManage}
              onChange={(event) => setSecondEndTime(event.target.value)}
            />
          ) : null}
        </div>
        {firstInvalid ? <p className="mt-1 text-xs text-danger-600">End must be after start.</p> : null}
        {secondInvalid ? (
          <p className="mt-1 text-xs text-danger-600">
            The afternoon must start after the morning ends, and end after it starts.
          </p>
        ) : null}
      </TableCell>
      {canManage ? (
        <TableCell className="text-right">
          <Button size="sm" variant="secondary" disabled={!isDirty || isInvalid} isLoading={isSaving} onClick={() => void handleSave()}>
            Save
          </Button>
        </TableCell>
      ) : null}
    </TableRow>
  )
}

// --- Barber availability exceptions ---------------------------------------------

const exceptionSchema = z
  .object({
    exceptionDate: z.string().min(1, 'Date is required'),
    isUnavailable: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    reason: z.string(),
  })
  .refine((values) => values.isUnavailable || (values.startTime && values.endTime && values.startTime < values.endTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  })

type ExceptionFormValues = z.infer<typeof exceptionSchema>

function ExceptionsSection({
  organizationId,
  barberId,
  canManage,
}: {
  organizationId: string
  barberId: string
  canManage: boolean
}) {
  const { toast } = useToast()
  const exceptionsQuery = useBarberAvailabilityExceptions(organizationId, barberId)
  const deleteException = useDeleteBarberAvailabilityException()
  const [dialogOpen, setDialogOpen] = useState(false)

  const upcoming = useMemo(() => {
    const today = todayIsoDate()
    return (exceptionsQuery.data ?? []).filter((exception) => exception.exceptionDate >= today)
  }, [exceptionsQuery.data])

  function handleDelete(exception: BarberAvailabilityException) {
    deleteException.mutate(
      { id: exception.id, organizationId, barberId },
      {
        onSuccess: () => toast({ title: 'Time off removed', variant: 'success' }),
        onError: (error) =>
          toast({
            title: "Couldn't remove time off",
            description: getErrorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-950">Upcoming time off &amp; overrides</h3>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
            Add override
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        {exceptionsQuery.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : exceptionsQuery.isError ? (
          <ErrorState
            title="Couldn't load overrides"
            description={exceptionsQuery.error.message}
            action={
              <Button variant="secondary" size="sm" onClick={() => void exceptionsQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : upcoming.length === 0 ? (
          <EmptyState title="No upcoming overrides" description="This barber follows their regular weekly hours." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {upcoming.map((exception) => (
              <li key={exception.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-950">
                      {new Date(`${exception.exceptionDate}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <Badge variant={exception.isUnavailable ? 'danger' : 'info'}>
                      {exception.isUnavailable
                        ? 'Unavailable'
                        : `${toTimeInputValue(exception.startTime)}–${toTimeInputValue(exception.endTime)}`}
                    </Badge>
                  </div>
                  {exception.reason ? <span className="truncate text-xs text-ink-500">{exception.reason}</span> : null}
                </div>
                {canManage ? (
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={deleteException.isPending && deleteException.variables?.id === exception.id}
                    onClick={() => handleDelete(exception)}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialogOpen ? (
        <ExceptionFormDialog organizationId={organizationId} barberId={barberId} onClose={() => setDialogOpen(false)} />
      ) : null}
    </div>
  )
}

function ExceptionFormDialog({
  organizationId,
  barberId,
  onClose,
}: {
  organizationId: string
  barberId: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const createException = useCreateBarberAvailabilityException()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ExceptionFormValues>({
    resolver: zodResolver(exceptionSchema),
    defaultValues: {
      exceptionDate: todayIsoDate(),
      isUnavailable: true,
      startTime: '',
      endTime: '',
      reason: '',
    },
  })

  const isUnavailable = watch('isUnavailable')

  async function onSubmit(values: ExceptionFormValues) {
    setFormError(null)
    try {
      await createException.mutateAsync({
        organizationId,
        barberId,
        exceptionDate: values.exceptionDate,
        isUnavailable: values.isUnavailable,
        startTime: values.isUnavailable ? null : values.startTime,
        endTime: values.isUnavailable ? null : values.endTime,
        reason: values.reason || null,
      })
      toast({ title: 'Override added', variant: 'success' })
      onClose()
    } catch (error) {
      if (getErrorMessage(error)?.toLowerCase().includes('duplicate')) {
        setFormError('This barber already has an override for that date.')
        return
      }
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add override</DialogTitle>
          <DialogDescription>Set a one-off exception to this barber&apos;s regular schedule.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField
            label="Date"
            type="date"
            min={todayIsoDate()}
            error={errors.exceptionDate?.message}
            {...register('exceptionDate')}
          />
          <Switch label="Unavailable all day" {...register('isUnavailable')} />

          {!isUnavailable ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="exception-start" className="text-sm font-medium text-ink-950">
                  Start time
                </label>
                <input id="exception-start" type="time" className={TIME_INPUT_CLASSES} {...register('startTime')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="exception-end" className="text-sm font-medium text-ink-950">
                  End time
                </label>
                <input id="exception-end" type="time" className={TIME_INPUT_CLASSES} {...register('endTime')} />
                {errors.endTime ? <p className="text-xs text-danger-600">{errors.endTime.message}</p> : null}
              </div>
            </div>
          ) : null}

          <Textarea label="Reason (optional)" rows={2} {...register('reason')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              Add override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AvailabilitySkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
