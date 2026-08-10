import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { useOrgServices, type Service } from '@/lib/queries/services'
import { useOrgBarbers, type Barber } from '@/lib/queries/barbers'
import { useOrgStaffProfiles, type StaffProfile } from '@/lib/queries/staff-profiles'
import {
  useAddToQueue,
  useOrgQueue,
  useUpdateQueueEntryStatus,
  type QueueEntry,
  type QueueStatus,
} from '@/lib/queries/queue'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import type { MembershipRole } from '@/lib/types'

// Same broader role set as appointments (LOT 8) — owner/manager/receptionist
// run the front of house and can add/manage any walk-in. Distinct from a
// barber, who — since LOT 11 phase 1 — can now ALSO change status, but only
// on queue entries assigned specifically to them (see `isOwnBarber` below).
const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

const STATUS_LABELS: Record<QueueStatus, string> = {
  waiting: 'Waiting',
  called: 'Called',
  in_service: 'In service',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

const STATUS_BADGE_VARIANT: Record<QueueStatus, BadgeVariant> = {
  waiting: 'warning',
  called: 'info',
  in_service: 'accent',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

/** Valid staff-initiated status targets — 'waiting' is never a target, nothing moves back into line. */
const STATUS_TRANSITIONS: QueueStatus[] = ['called', 'in_service', 'completed', 'cancelled', 'no_show']

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

function formatWait(iso: string): string {
  const minutes = minutesSince(iso)
  return minutes < 1 ? 'Just now' : `${minutes} min`
}

export function AppQueuePage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <QueueBoard organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function QueueBoard({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const canManage = MANAGING_ROLES.has(role)
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)

  const locationsQuery = useOrgLocations(organizationId)
  const servicesQuery = useOrgServices(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const queueQuery = useOrgQueue(organizationId)

  const locations = locationsQuery.data ?? []
  const activeLocationId = selectedLocationId ?? locations[0]?.id ?? null
  const activeLocation = locations.find((location) => location.id === activeLocationId) ?? null

  const isLoading =
    locationsQuery.isPending || servicesQuery.isPending || barbersQuery.isPending || staffProfilesQuery.isPending || queueQuery.isPending

  const loadError = locationsQuery.error ?? servicesQuery.error ?? barbersQuery.error ?? staffProfilesQuery.error ?? queueQuery.error

  const isError =
    locationsQuery.isError || servicesQuery.isError || barbersQuery.isError || staffProfilesQuery.isError || queueQuery.isError

  function refetchAll() {
    void locationsQuery.refetch()
    void servicesQuery.refetch()
    void barbersQuery.refetch()
    void staffProfilesQuery.refetch()
    void queueQuery.refetch()
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

  // "Is this queue entry's barber_id me?" — resolved via my own staff_profiles
  // row (matched on auth user id) and then my own barbers row (matched on
  // that profile), same join pattern as `barberName` below, in reverse.
  const ownBarberId = useMemo(() => {
    if (!user) return null
    const ownProfile = (staffProfilesQuery.data ?? []).find((profile) => profile.userId === user.id)
    if (!ownProfile) return null
    const ownBarber = (barbersQuery.data ?? []).find((barber) => barber.staffProfileId === ownProfile.id)
    return ownBarber?.id ?? null
  }, [user, staffProfilesQuery.data, barbersQuery.data])

  function isOwnBarber(barberId: string | null): boolean {
    return barberId !== null && barberId === ownBarberId
  }

  const queueByLocation = useMemo(() => {
    const map = new Map<string, QueueEntry[]>()
    for (const entry of queueQuery.data ?? []) {
      const list = map.get(entry.locationId) ?? []
      list.push(entry)
      map.set(entry.locationId, list)
    }
    return map
  }, [queueQuery.data])

  function barberName(barberId: string | null): string {
    if (!barberId) return 'Any barber'
    const staffProfileId = barberById.get(barberId)?.staffProfileId
    if (!staffProfileId) return 'Unassigned'
    return staffProfileById.get(staffProfileId)?.displayName ?? 'Unnamed barber'
  }

  return (
    <Container size="lg" className="py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">Live queue</h1>
          <p className="mt-1 text-sm text-ink-500">Who&apos;s waiting, right now, at each location.</p>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <QueueSkeleton />
        ) : isError ? (
          <ErrorState
            title="Couldn't load the queue"
            description={loadError?.message}
            action={
              <Button variant="secondary" onClick={refetchAll}>
                Try again
              </Button>
            }
          />
        ) : locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            description="Add a location before managing a walk-in queue."
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
                <LocationQueue
                  location={location}
                  entries={queueByLocation.get(location.id) ?? []}
                  canManage={canManage}
                  isOwnBarber={isOwnBarber}
                  barberName={barberName}
                  serviceById={serviceById}
                  onAddWalkIn={() => setIsAddOpen(true)}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {isAddOpen && activeLocation ? (
        <AddWalkInDialog
          organizationId={organizationId}
          location={activeLocation}
          services={servicesQuery.data ?? []}
          barbers={barbersQuery.data ?? []}
          staffProfiles={staffProfilesQuery.data ?? []}
          onClose={() => setIsAddOpen(false)}
          onAdded={() => {
            toast({ title: 'Added to queue', variant: 'success' })
            setIsAddOpen(false)
          }}
        />
      ) : null}
    </Container>
  )
}

// --- Queue list ------------------------------------------------------------

interface QueueRowData extends QueueEntry {
  position: number | null
}

function LocationQueue({
  location,
  entries,
  canManage,
  isOwnBarber,
  barberName,
  serviceById,
  onAddWalkIn,
}: {
  location: Location
  entries: QueueEntry[]
  canManage: boolean
  isOwnBarber: (barberId: string | null) => boolean
  barberName: (barberId: string | null) => string
  serviceById: Map<string, Service>
  onAddWalkIn: () => void
}) {
  // Position is derived client-side from arrival order among `waiting`
  // entries only — never stored. Entries already being called/serviced show
  // no position, they've left the line.
  const rows: QueueRowData[] = useMemo(() => {
    const waiting = entries.filter((entry) => entry.status === 'waiting')
    const positionByEntryId = new Map(waiting.map((entry, index) => [entry.id, index + 1]))
    return entries.map((entry) => ({ ...entry, position: positionByEntryId.get(entry.id) ?? null }))
  }, [entries])

  const showActionsColumn = canManage || rows.some((row) => isOwnBarber(row.barberId))
  const columnCount = showActionsColumn ? 6 : 5

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={onAddWalkIn}>
            Add walk-in
          </Button>
        ) : null}
      </div>
      <Table label={`Queue at ${location.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Position</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Barber</TableHead>
            <TableHead>Waited</TableHead>
            <TableHead>Status</TableHead>
            {showActionsColumn ? (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableStateRow colSpan={columnCount}>
              <EmptyState
                title="No one is waiting"
                description={canManage ? 'The queue at this location is empty right now.' : 'Nothing to do here right now.'}
                action={
                  canManage ? (
                    <Button size="sm" onClick={onAddWalkIn}>
                      Add walk-in
                    </Button>
                  ) : undefined
                }
                className="border-none"
              />
            </TableStateRow>
          ) : (
            rows.map((entry) => (
              <QueueRow
                key={entry.id}
                entry={entry}
                canAct={canManage || isOwnBarber(entry.barberId)}
                showActionsColumn={showActionsColumn}
                barberLabel={barberName(entry.barberId)}
                serviceName={entry.serviceId ? (serviceById.get(entry.serviceId)?.name ?? 'Unknown service') : '—'}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function QueueRow({
  entry,
  canAct,
  showActionsColumn,
  barberLabel,
  serviceName,
}: {
  entry: QueueRowData
  canAct: boolean
  showActionsColumn: boolean
  barberLabel: string
  serviceName: string
}) {
  const { toast } = useToast()
  const updateStatus = useUpdateQueueEntryStatus()

  function handleStatusChange(status: QueueStatus) {
    updateStatus.mutate(
      { id: entry.id, organizationId: entry.organizationId, status },
      {
        onSuccess: () => toast({ title: `Marked ${STATUS_LABELS[status].toLowerCase()}`, variant: 'success' }),
        onError: (error) =>
          toast({
            title: "Couldn't update status",
            description: error instanceof Error ? error.message : undefined,
            variant: 'error',
          }),
      },
    )
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-medium text-ink-950">
        {entry.position ? `#${entry.position}` : '—'}
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-ink-950">{entry.customerName}</span>
          {entry.customerPhone ? <span className="text-xs text-ink-500">{entry.customerPhone}</span> : null}
          <span className="text-xs text-ink-500">{serviceName}</span>
        </div>
      </TableCell>
      <TableCell className="text-ink-500">{barberLabel}</TableCell>
      <TableCell className="text-ink-500">{formatWait(entry.createdAt)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[entry.status]}>{STATUS_LABELS[entry.status]}</Badge>
      </TableCell>
      {showActionsColumn ? (
        <TableCell className="text-right">
          {canAct ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" isLoading={updateStatus.isPending}>
                  Update status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STATUS_TRANSITIONS.filter((status) => status !== entry.status).map((status) => (
                  <DropdownMenuItem
                    key={status}
                    variant={status === 'cancelled' || status === 'no_show' ? 'danger' : 'default'}
                    onSelect={() => handleStatusChange(status)}
                  >
                    Mark {STATUS_LABELS[status].toLowerCase()}
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

// --- Add walk-in dialog ------------------------------------------------------

const addWalkInSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string(),
  barberId: z.string(),
  serviceId: z.string(),
})

type AddWalkInFormValues = z.infer<typeof addWalkInSchema>

function AddWalkInDialog({
  organizationId,
  location,
  services,
  barbers,
  staffProfiles,
  onClose,
  onAdded,
}: {
  organizationId: string
  location: Location
  services: Service[]
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  onClose: () => void
  onAdded: () => void
}) {
  const { user } = useAuth()
  const addToQueue = useAddToQueue()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddWalkInFormValues>({
    resolver: zodResolver(addWalkInSchema),
    defaultValues: { customerName: '', customerPhone: '', barberId: '', serviceId: '' },
  })

  const staffProfileById = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfiles) map.set(profile.id, profile)
    return map
  }, [staffProfiles])

  const bookableBarbers = useMemo(() => barbers.filter((barber) => barber.isBookable), [barbers])
  const activeServices = useMemo(() => services.filter((service) => service.isActive), [services])

  async function onSubmit(values: AddWalkInFormValues) {
    setFormError(null)
    try {
      await addToQueue.mutateAsync({
        organizationId,
        locationId: location.id,
        barberId: values.barberId || null,
        serviceId: values.serviceId || null,
        customerName: values.customerName.trim(),
        customerPhone: values.customerPhone.trim() || null,
        notes: null,
        createdBy: user?.id ?? null,
      })
      onAdded()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong.')
    }
  }

  const barberOptions = [
    { value: '', label: 'Any available barber' },
    ...bookableBarbers.map((barber) => ({
      value: barber.id,
      label: staffProfileById.get(barber.staffProfileId)?.displayName ?? 'Unnamed barber',
    })),
  ]

  const serviceOptions = [
    { value: '', label: 'No service specified' },
    ...activeServices.map((service) => ({
      value: service.id,
      label: `${service.name} · ${service.durationMinutes} min`,
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
          <DialogTitle>Add walk-in</DialogTitle>
          <DialogDescription>Add a customer to the line at {location.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label="Customer name" error={errors.customerName?.message} {...register('customerName')} />
          <TextField label="Phone (optional)" type="tel" {...register('customerPhone')} />
          <SelectField label="Barber (optional)" options={barberOptions} {...register('barberId')} />
          <SelectField label="Service (optional)" options={serviceOptions} {...register('serviceId')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              Add to queue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
