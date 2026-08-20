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
import { PageHeader } from '@/components/ui/page-header'
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
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

// Same broader role set as appointments/queue_entries/customers — waitlist
// RLS grants owner/manager/receptionist write access, any member read.
const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

/**
 * Only the COLOUR lives in a constant. The words are translated at render —
 * a `Record<Status, string>` of English sentences cannot be, which is exactly
 * how the whole status vocabulary of this page stayed English while every
 * label around it was translated.
 */

const STATUS_BADGE_VARIANT: Record<WaitlistStatus, BadgeVariant> = {
  waiting: 'warning',
  notified: 'info',
  booked: 'success',
  cancelled: 'neutral',
  expired: 'neutral',
}

/** Valid staff-initiated status targets — 'waiting' is never a target, nothing moves back onto the waitlist. */
const STATUS_TRANSITIONS: WaitlistStatus[] = ['notified', 'booked', 'cancelled', 'expired']

function formatWaitingSince(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
}

export function AppWaitlistPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <WaitlistBoard organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function WaitlistBoard({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { t } = useTranslation()
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
    if (!barberId) return t('app:waitlist.anyProfessional')
    const staffProfileId = barberById.get(barberId)?.staffProfileId
    if (!staffProfileId) return t('app:waitlist.unassigned')
    return staffProfileById.get(staffProfileId)?.displayName ?? t('app:waitlist.unnamedProfessional')
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('common:entity.waitlist')} subtitle={t('app:waitlist.customersWaitingForAnOpening')} />

      <div>
        {isLoading ? (
          <WaitlistSkeleton />
        ) : isError ? (
          <ErrorState
            title={t('app:waitlist.couldntLoadTheWaitlist')}
            description={loadError?.message}
            action={
              <Button variant="secondary" onClick={refetchAll}>
                {t('common:action.tryAgain')}
              </Button>
            }
          />
        ) : locations.length === 0 ? (
          <EmptyState
            title={t('app:waitlist.noLocationsYet')}
            description={t('app:waitlist.addALocationBeforeManaging')}
            action={
              <Link to="/app/locations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                {t('app:waitlist.goToLocations')}
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
            toast({ title: t('app:waitlist.addedToWaitlist'), variant: 'success' })
            setIsAddOpen(false)
          }}
        />
      ) : null}
    </div>
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
  const { t } = useTranslation()
  const columnCount = canManage ? 6 : 5

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={onAddEntry}>
            {t('app:waitlist.addToWaitlist')}
          </Button>
        ) : null}
      </div>
      <Table label={`Waitlist at ${location.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common:entity.customer')}</TableHead>
            <TableHead>{t('app:waitlist.wants')}</TableHead>
            <TableHead>{t('app:waitlist.preferredBarber')}</TableHead>
            <TableHead>{t('app:waitlist.waitingSince')}</TableHead>
            <TableHead>{t('common:field.status')}</TableHead>
            {canManage ? (
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableStateRow colSpan={columnCount}>
              <EmptyState
                title={t('app:waitlist.noOneIsWaiting')}
                description={canManage ? 'The waitlist at this location is empty right now.' : 'Nothing to do here right now.'}
                action={
                  canManage ? (
                    <Button size="sm" onClick={onAddEntry}>
                      {t('app:waitlist.addToWaitlist')}
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
                serviceName={
                  entry.desiredServiceId
                    ? (serviceById.get(entry.desiredServiceId)?.name ?? t('app:waitlist.unknownService'))
                    : t('app:waitlist.anything')
                }
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
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const updateStatus = useUpdateWaitlistEntryStatus()

  function handleStatusChange(status: WaitlistStatus) {
    updateStatus.mutate(
      { id: entry.id, organizationId: entry.organizationId, status },
      {
        onSuccess: () => toast({ title: t('app:waitlist.markedAs', { status: t(`app:waitlistStatus.${status}`) }), variant: 'success' }),
        onError: (error) =>
          toast({
            title: t('app:waitlist.couldntUpdateStatus'),
            description: getErrorMessage(error),
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
      <TableCell className="text-ink-500">{formatWaitingSince(entry.createdAt, i18n.language)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[entry.status]}>{t(`app:waitlistStatus.${entry.status}`)}</Badge>
      </TableCell>
      {canManage ? (
        <TableCell className="text-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" isLoading={updateStatus.isPending}>
                {t('app:waitlist.updateStatus')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_TRANSITIONS.filter((status) => status !== entry.status).map((status) => (
                <DropdownMenuItem
                  key={status}
                  variant={status === 'cancelled' || status === 'expired' ? 'danger' : 'default'}
                  onSelect={() => handleStatusChange(status)}
                >
                  {t('app:waitlist.markAs', { status: t(`app:waitlistStatus.${status}`) })}
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
  const { t } = useTranslation()
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
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
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
          <DialogTitle>{t('app:waitlist.addToWaitlist')}</DialogTitle>
          <DialogDescription>Add a customer waiting for an opening at {location.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label={t('common:field.customerName')} error={errors.customerName?.message} {...register('customerName')} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label={t('common:field.phoneOptional')} type="tel" {...register('customerPhone')} />
            <TextField label={t('common:field.emailOptional')} type="email" {...register('customerEmail')} />
          </div>
          <SelectField label={t('app:waitlist.wantsOptional')} options={serviceOptions} {...register('desiredServiceId')} />
          <SelectField label={t('app:waitlist.preferredBarberOptional')} options={barberOptions} {...register('desiredBarberId')} />
          <Textarea label={t('common:field.notesOptional')} rows={2} {...register('notes')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t('common:action.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {t('app:waitlist.addToWaitlist')}
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
