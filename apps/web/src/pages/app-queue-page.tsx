import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Users } from 'lucide-react'
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
import { QueueEntryCard } from '@/components/pro/queue-entry-card'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
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
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * `/app/queue` — the live walk-in line.
 *
 * ============================================================================
 * A TABLE WAS THE WRONG SHAPE
 * ============================================================================
 *
 * V1 rendered this as a six-column table. Two problems, both fatal for the
 * people who actually use it:
 *
 *   1. Every status change cost two taps through a dropdown of six options.
 *   2. Six columns do not fit a 375px screen, so the most operational screen
 *      in the product scrolled sideways — on the device it is used on.
 *
 * V2 is a list of cards, split by where each person is in the line, with the
 * one obvious action as a real button. The front of the queue is promoted to
 * its own card, because "who is next" is the question this screen exists to
 * answer and it should not require reading a table.
 *
 * The status vocabulary was also plain English constants — "Waiting",
 * "Called", "Mark no-show" — on a screen the product otherwise ships in ten
 * languages. It now goes through i18n like everything else.
 *
 * Nothing about permissions changed: front-of-house manages anyone,
 * a professional manages only entries assigned to them (LOT 11 phase 1),
 * and the server enforces both regardless of what this file renders.
 */

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

/** Still in the line, in the order they moved through it. */
const ACTIVE_STATUSES: QueueStatus[] = ['waiting', 'called', 'in_service']

export function AppQueuePage() {
  const { t } = useTranslation('app')
  const { toast } = useToast()
  const { user } = useAuth()
  const { currentMembership } = useCurrentOrg()
  const organizationId = currentMembership?.organizationId
  const canManage = currentMembership ? MANAGING_ROLES.has(currentMembership.role as MembershipRole) : false

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
    locationsQuery.isPending ||
    servicesQuery.isPending ||
    barbersQuery.isPending ||
    staffProfilesQuery.isPending ||
    queueQuery.isPending

  const loadError =
    locationsQuery.error ?? servicesQuery.error ?? barbersQuery.error ?? staffProfilesQuery.error ?? queueQuery.error

  const isError =
    locationsQuery.isError ||
    servicesQuery.isError ||
    barbersQuery.isError ||
    staffProfilesQuery.isError ||
    queueQuery.isError

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

  // "Is this entry's barber_id me?" — resolved through my own staff_profiles
  // row (matched on auth user id) and then my own barbers row.
  const ownBarberId = useMemo(() => {
    if (!user) return null
    const ownProfile = (staffProfilesQuery.data ?? []).find((profile) => profile.userId === user.id)
    if (!ownProfile) return null
    return (barbersQuery.data ?? []).find((barber) => barber.staffProfileId === ownProfile.id)?.id ?? null
  }, [user, staffProfilesQuery.data, barbersQuery.data])

  function isOwnBarber(barberId: string | null): boolean {
    return barberId !== null && barberId === ownBarberId
  }

  function barberName(barberId: string | null): string {
    if (!barberId) return t('queue.anyProfessional')
    const staffProfileId = barberById.get(barberId)?.staffProfileId
    if (!staffProfileId) return t('queue.unassigned')
    return staffProfileById.get(staffProfileId)?.displayName ?? t('queue.unnamedProfessional')
  }

  const entries = useMemo(
    () => (queueQuery.data ?? []).filter((entry) => entry.locationId === activeLocationId),
    [queueQuery.data, activeLocationId],
  )

  const { upNext, rest, active, finished } = useMemo(() => {
    // Position is derived from arrival order among `waiting` only, and never
    // stored — an entry that has been called has left the line.
    const waiting = entries.filter((entry) => entry.status === 'waiting')
    const inFlight = entries.filter((entry) => entry.status === 'called' || entry.status === 'in_service')
    return {
      upNext: waiting[0] ?? null,
      rest: waiting.slice(1),
      active: inFlight,
      finished: entries.filter((entry) => !ACTIVE_STATUSES.includes(entry.status)),
    }
  }, [entries])

  const waitingCount = upNext ? rest.length + 1 : 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('queue.liveQueue')}
        subtitle={activeLocation ? t('queue.whoIsWaitingAt', { location: activeLocation.name }) : undefined}
        actions={
          canManage && activeLocation ? (
            <Button onClick={() => setIsAddOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
              {t('queue.addWalkin')}
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <QueueSkeleton />
      ) : isError ? (
        <ErrorState
          title={t('queue.couldntLoadTheQueue')}
          description={loadError?.message}
          action={
            <Button variant="secondary" onClick={refetchAll}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      ) : locations.length === 0 ? (
        <EmptyState
          title={t('queue.noLocationsYet')}
          description={t('queue.addALocationBeforeManaging')}
          action={
            <Link to="/app/locations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              {t('queue.goToLocations')}
            </Link>
          }
        />
      ) : (
        <>
          {/* Only when there is a choice to make. A single-location shop gets
              no control at all rather than a control with one option. */}
          {locations.length > 1 ? (
            <SegmentedControl
              options={locations.map((location) => ({ value: location.id, label: location.name }))}
              value={activeLocationId ?? locations[0]!.id}
              onChange={setSelectedLocationId}
              ariaLabel={t('common:entity.location')}
            />
          ) : null}

          {upNext === null && active.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('queue.nobodyWaiting')}
              description={t('queue.nobodyWaitingBody')}
              action={
                canManage ? (
                  <Button size="sm" onClick={() => setIsAddOpen(true)}>
                    {t('queue.addWalkin')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              {/* IN THE CHAIR FIRST. Someone being served now outranks someone
                  who is next, because they are the one whose state is about
                  to change. */}
              {active.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <SectionHeader title={t('queue.inProgress')} meta={String(active.length)} />
                  {active.map((entry) => (
                    <ManagedEntry
                      key={entry.id}
                      entry={entry}
                      position={null}
                      canAct={canManage || isOwnBarber(entry.barberId)}
                      barberLabel={barberName(entry.barberId)}
                      serviceName={entry.serviceId ? (serviceById.get(entry.serviceId)?.name ?? null) : null}
                    />
                  ))}
                </section>
              ) : null}

              {upNext ? (
                <section className="flex flex-col gap-2">
                  <SectionHeader
                    title={t('queue.waitingSection')}
                    meta={t('queue.waitingCount', { count: waitingCount })}
                  />
                  <ManagedEntry
                    entry={upNext}
                    position={1}
                    emphasis
                    canAct={canManage || isOwnBarber(upNext.barberId)}
                    barberLabel={barberName(upNext.barberId)}
                    serviceName={upNext.serviceId ? (serviceById.get(upNext.serviceId)?.name ?? null) : null}
                  />
                  {rest.map((entry, index) => (
                    <ManagedEntry
                      key={entry.id}
                      entry={entry}
                      position={index + 2}
                      canAct={canManage || isOwnBarber(entry.barberId)}
                      barberLabel={barberName(entry.barberId)}
                      serviceName={entry.serviceId ? (serviceById.get(entry.serviceId)?.name ?? null) : null}
                    />
                  ))}
                </section>
              ) : null}
            </div>
          )}

          {/* Finished entries are history, not work. Collapsed by default so
              a busy afternoon does not bury the three people still waiting. */}
          {finished.length > 0 ? (
            <details className="group rounded-xl border border-border bg-paper-0">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700">
                {t('queue.doneToday', { count: finished.length })}
                <span aria-hidden="true" className="text-ink-500 transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="flex flex-col gap-2 border-t border-border p-3">
                {finished.map((entry) => (
                  <ManagedEntry
                    key={entry.id}
                    entry={entry}
                    position={null}
                    canAct={false}
                    barberLabel={barberName(entry.barberId)}
                    serviceName={entry.serviceId ? (serviceById.get(entry.serviceId)?.name ?? null) : null}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}

      {isAddOpen && activeLocation && organizationId ? (
        <AddWalkInDialog
          organizationId={organizationId}
          location={activeLocation}
          services={servicesQuery.data ?? []}
          barbers={barbersQuery.data ?? []}
          staffProfiles={staffProfilesQuery.data ?? []}
          onClose={() => setIsAddOpen(false)}
          onAdded={() => {
            toast({ title: t('queue.addedToQueue'), variant: 'success' })
            setIsAddOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The card, plus the mutation. Kept together so each entry owns its own
 * pending state — a spinner on the row you tapped, not on the whole list.
 */
function ManagedEntry({
  entry,
  position,
  canAct,
  barberLabel,
  serviceName,
  emphasis,
}: {
  entry: QueueEntry
  position: number | null
  canAct: boolean
  barberLabel: string
  serviceName: string | null
  emphasis?: boolean
}) {
  const { t } = useTranslation('app')
  const { toast } = useToast()
  const updateStatus = useUpdateQueueEntryStatus()

  return (
    <QueueEntryCard
      entry={entry}
      position={position}
      barberLabel={barberLabel}
      serviceName={serviceName}
      canAct={canAct}
      emphasis={emphasis}
      isPending={updateStatus.isPending}
      onStatusChange={(status) =>
        updateStatus.mutate(
          { id: entry.id, organizationId: entry.organizationId, status },
          {
            onSuccess: () =>
              toast({ title: t('queue.markedAs', { status: t(`queue.status.${status}`) }), variant: 'success' }),
            onError: (error) =>
              toast({
                title: t('queue.couldntUpdateStatus'),
                description: getErrorMessage(error),
                variant: 'error',
              }),
          },
        )
      }
    />
  )
}

// --- add walk-in ------------------------------------------------------------

const addWalkInSchema = z.object({
  customerName: z.string().min(1, 'validation.customerNameRequired'),
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
  const { t } = useTranslation('app')
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
      setFormError(getErrorMessage(error) ?? t('common:state.somethingWentWrong'))
    }
  }

  const barberOptions = [
    { value: '', label: t('queue.anyProfessional') },
    ...barbers
      .filter((barber) => barber.isBookable)
      .map((barber) => ({
        value: barber.id,
        label: staffProfileById.get(barber.staffProfileId)?.displayName ?? t('queue.unnamedProfessional'),
      })),
  ]

  const serviceOptions = [
    { value: '', label: t('queue.noServiceSpecified') },
    ...services
      .filter((service) => service.isActive)
      .map((service) => ({ value: service.id, label: `${service.name} · ${service.durationMinutes} min` })),
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
          <DialogTitle>{t('queue.addWalkin')}</DialogTitle>
          <DialogDescription>{t('queue.addWalkinAt', { location: location.name })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField
            label={t('common:field.customerName')}
            autoComplete="off"
            // The one required field, and the first thing anyone types.
            autoFocus
            error={errors.customerName?.message ? t(errors.customerName.message) : undefined}
            {...register('customerName')}
          />
          <TextField label={t('common:field.phoneOptional')} type="tel" {...register('customerPhone')} />
          <SelectField label={t('queue.barberOptional')} options={barberOptions} {...register('barberId')} />
          <SelectField label={t('queue.serviceOptional')} options={serviceOptions} {...register('serviceId')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t('common:action.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {t('queue.addToQueue')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-3/4 rounded-xl" />
    </div>
  )
}
