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
  useAddToWaitlist,
  useOrgWaitlist,
  useUpdateWaitlistEntryStatus,
  type WaitlistEntry,
  type WaitlistStatus,
} from '@/lib/queries/waitlist'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
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

// Same broader role set as appointments/queue_entries/customers — waitlist
// RLS grants owner/manager/receptionist write access, any member read.
const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

const STATUS_LABELS: Record<WaitlistStatus, string> = {
  waiting: 'Waiting',
  notified: 'Notified',
  booked: 'Booked',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

const STATUS_BADGE_VARIANT: Record<WaitlistStatus, BadgeVariant> = {
  waiting: 'warning',
  notified: 'info',
  booked: 'success',
  cancelled: 'neutral',
  expired: 'neutral',
}

/** Valid staff-initiated status targets — 'waiting' is never a target, nothing moves back onto the waitlist. */
const STATUS_TRANSITIONS: WaitlistStatus[] = ['notified', 'booked', 'cancelled', 'expired']

function formatWaitingSince(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

export function AppWaitlistPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <WaitlistBoard organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function WaitlistBoard({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const canManage = MANAGING_ROLES.has(role)
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)

  const locationsQuery = useOrgLocations(organizationId)
  const servicesQuery = useOrgServices(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const waitlistQuery = useOrgWaitlist(organizationId)

  const locations = locationsQuery.data ?? []
  const activeLocationId = selectedLocationId ?? locations[0]?.id ?? null
  const activeLocation = locations.find((location) => location.id === activeLocationId) ?? null

  const isLoading =
    locationsQuery.isPending || servicesQuery.isPending || barbersQuery.isPending || staffProfilesQuery.isPending || waitlistQuery.isPending

  const loadError = locationsQuery.error ?? servicesQuery.error ?? barbersQuery.error ?? staffProfilesQuery.error ?? waitlistQuery.error

  const isError =
    locationsQuery.isError || servicesQuery.isError || barbersQuery.isError || staffProfilesQuery.isError || waitlistQuery.isError

  function refetchAll() {
    void locationsQuery.refetch()
    void servicesQuery.refetch()
    void barbersQuery.refetch()
    void staffProfilesQuery.refetch()
    void waitlistQuery.refetch()
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

  const waitlistByLocation = useMemo(() => {
    const map = new Map<string, WaitlistEntry[]>()
    for (const entry of waitlistQuery.data ?? []) {
      const list = map.get(entry.locationId) ?? []
      list.push(entry)
      map.set(entry.locationId, list)
    }
    return map
  }, [waitlistQuery.data])

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
          <h1 className="text-xl font-semibold text-ink-950">Waitlist</h1>
          <p className="mt-1 text-sm text-ink-500">Customers waiting for an opening, per location.</p>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <WaitlistSkeleton />
        ) : isError ? (
          <ErrorState
            title="Couldn't load the waitlist"
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
            description="Add a location before managing a waitlist."
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
                <LocationWaitlist
                  location={location}
                  entries={waitlistByLocation.get(location.id) ?? []}
                  canManage={canManage}
                  barberName={barberName}
                  serviceById={serviceById}
                  onAddEntry={() => setIsAddOpen(true)}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {isAddOpen && activeLocation ? (
        <AddToWaitlistDialog
          organizationId={organizationId}
          location={activeLocation}
          services={servicesQuery.data ?? []}
          barbers={barbersQuery.data ?? []}
          staffProfiles={staffProfilesQuery.data ?? []}
          createdBy={user?.id ?? null}
          onClose={() => setIsAddOpen(false)}
          onAdded={() => {
            toast({ title: 'Added to waitlist', variant: 'success' })
            setIsAddOpen(false)
          }}
        />
      ) : null}
    </Container>
  )
}

// --- Waitlist list -----------------------------------------------------------

function LocationWaitlist({
  location,
  entries,
  canManage,
  barberName,
  serviceById,
  onAddEntry,
}: {
  location: Location
  entries: WaitlistEntry[]
  canManage: boolean
  barberName: (barberId: string | null) => string
  serviceById: Map<string, Service>
  onAddEntry: () => void
}) {
  const columnCount = canManage ? 6 : 5

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={onAddEntry}>
            Add to waitlist
          </Button>
        ) : null}
      </div>
      <Table label={`Waitlist at ${location.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Wants</TableHead>
            <TableHead>Preferred barber</TableHead>
            <TableHead>Waiting since</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableStateRow colSpan={columnCount}>
              <EmptyState
                title="No one is waiting"
                description={canManage ? 'The waitlist at this location is empty right now.' : 'Nothing to do here right now.'}
                action={
                  canManage ? (
                    <Button size="sm" onClick={onAddEntry}>
                      Add to waitlist
                    </Button>
                  ) : undefined
                }
                className="border-none"
              />
            </TableStateRow>
          ) : (
            entries.map((entry) => (
              <WaitlistRow
                key={entry.id}
                entry={entry}
                canManage={canManage}
                barberLabel={barberName(entry.desiredBarberId)}
                serviceName={entry.desiredServiceId ? (serviceById.get(entry.desiredServiceId)?.name ?? 'Unknown service') : 'Anything'}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function WaitlistRow({
  entry,
  canManage,
  barberLabel,
  serviceName,
}: {
  entry: WaitlistEntry
  canManage: boolean
  barberLabel: string
  serviceName: string
}) {
  const { toast } = useToast()
  const updateStatus = useUpdateWaitlistEntryStatus()

  function handleStatusChange(status: WaitlistStatus) {
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
      <TableCell>
        <div className="flex flex-col">
          <span className="text-ink-950">{entry.customerName}</span>
          {entry.customerPhone ? <span className="text-xs text-ink-500">{entry.customerPhone}</span> : null}
        </div>
      </TableCell>
      <TableCell className="text-ink-500">{serviceName}</TableCell>
      <TableCell className="text-ink-500">{barberLabel}</TableCell>
      <TableCell className="text-ink-500">{formatWaitingSince(entry.createdAt)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[entry.status]}>{STATUS_LABELS[entry.status]}</Badge>
      </TableCell>
      {canManage ? (
        <TableCell className="text-right">
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
                  variant={status === 'cancelled' || status === 'expired' ? 'danger' : 'default'}
                  onSelect={() => handleStatusChange(status)}
                >
                  Mark {STATUS_LABELS[status].toLowerCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      ) : null}
    </TableRow>
  )
}

// --- Add to waitlist dialog --------------------------------------------------

const addWaitlistSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string(),
  customerEmail: z.string(),
  desiredServiceId: z.string(),
  desiredBarberId: z.string(),
  notes: z.string(),
})

type AddWaitlistFormValues = z.infer<typeof addWaitlistSchema>

function AddToWaitlistDialog({
  organizationId,
  location,
  services,
  barbers,
  staffProfiles,
  createdBy,
  onClose,
  onAdded,
}: {
  organizationId: string
  location: Location
  services: Service[]
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  createdBy: string | null
  onClose: () => void
  onAdded: () => void
}) {
  const addToWaitlist = useAddToWaitlist()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddWaitlistFormValues>({
    resolver: zodResolver(addWaitlistSchema),
    defaultValues: {
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      desiredServiceId: '',
      desiredBarberId: '',
      notes: '',
    },
  })

  const staffProfileById = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfiles) map.set(profile.id, profile)
    return map
  }, [staffProfiles])

  const bookableBarbers = useMemo(() => barbers.filter((barber) => barber.isBookable), [barbers])
  const activeServices = useMemo(() => services.filter((service) => service.isActive), [services])

  async function onSubmit(values: AddWaitlistFormValues) {
    setFormError(null)
    try {
      await addToWaitlist.mutateAsync({
        organizationId,
        locationId: location.id,
        customerName: values.customerName.trim(),
        customerPhone: values.customerPhone.trim() || null,
        customerEmail: values.customerEmail.trim() || null,
        desiredServiceId: values.desiredServiceId || null,
        desiredBarberId: values.desiredBarberId || null,
        notes: values.notes.trim() || null,
        createdBy,
      })
      onAdded()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong.')
    }
  }

  const serviceOptions = [
    { value: '', label: 'Anything' },
    ...activeServices.map((service) => ({ value: service.id, label: service.name })),
  ]

  const barberOptions = [
    { value: '', label: 'No preference' },
    ...bookableBarbers.map((barber) => ({
      value: barber.id,
      label: staffProfileById.get(barber.staffProfileId)?.displayName ?? 'Unnamed barber',
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
          <DialogTitle>Add to waitlist</DialogTitle>
          <DialogDescription>Add a customer waiting for an opening at {location.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label="Customer name" error={errors.customerName?.message} {...register('customerName')} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Phone (optional)" type="tel" {...register('customerPhone')} />
            <TextField label="Email (optional)" type="email" {...register('customerEmail')} />
          </div>
          <SelectField label="Wants (optional)" options={serviceOptions} {...register('desiredServiceId')} />
          <SelectField label="Preferred barber (optional)" options={barberOptions} {...register('desiredBarberId')} />
          <Textarea label="Notes (optional)" rows={2} {...register('notes')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              Add to waitlist
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WaitlistSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
