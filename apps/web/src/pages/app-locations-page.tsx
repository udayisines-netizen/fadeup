import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCurrentOrg } from '@/lib/current-org-context'
import { guessTimezone } from '@/lib/timezone'
import {
  useCreateLocation,
  useOrgLocations,
  useUpdateLocation,
  type Location,
  type LocationInput,
} from '@/lib/queries/locations'
import { TextField } from '@/components/ui/text-field'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
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

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

const locationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  addressLine1: z.string(),
  addressLine2: z.string(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string(),
  timezone: z.string().min(1, 'Timezone is required'),
  isActive: z.boolean(),
})

type LocationFormValues = z.infer<typeof locationSchema>

type DialogState = { mode: 'create' } | { mode: 'edit'; location: Location } | null

function formatAddress(location: Location): string {
  const parts = [location.city, location.region, location.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

export function AppLocationsPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <LocationsManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function LocationsManagement({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const canManage = MANAGING_ROLES.has(role)
  const locationsQuery = useOrgLocations(organizationId)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const columnCount = canManage ? 5 : 4

  function handleSaved(message: string) {
    toast({ title: message, variant: 'success' })
    setDialogState(null)
  }

  return (
    <Container size="lg" className="py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">Locations</h1>
          <p className="mt-1 text-sm text-ink-500">Shops and addresses for your organization.</p>
        </div>
        {canManage ? <Button onClick={() => setDialogState({ mode: 'create' })}>Add location</Button> : null}
      </div>

      <div className="mt-6">
        {locationsQuery.isPending ? (
          <LocationsSkeleton />
        ) : locationsQuery.isError ? (
          <ErrorState
            title="Couldn't load locations"
            description={locationsQuery.error.message}
            action={
              <Button variant="secondary" onClick={() => void locationsQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <Table label="Locations">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {locationsQuery.data.length === 0 ? (
                <TableStateRow colSpan={columnCount}>
                  <EmptyState
                    title="No locations yet"
                    description={
                      canManage
                        ? 'Add your first location to get started.'
                        : 'Your organization has no locations yet.'
                    }
                    action={
                      canManage ? (
                        <Button size="sm" onClick={() => setDialogState({ mode: 'create' })}>
                          Add location
                        </Button>
                      ) : undefined
                    }
                    className="border-none"
                  />
                </TableStateRow>
              ) : (
                locationsQuery.data.map((location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium text-ink-950">{location.name}</TableCell>
                    <TableCell>{formatAddress(location)}</TableCell>
                    <TableCell className="whitespace-nowrap">{location.timezone}</TableCell>
                    <TableCell>
                      <Badge variant={location.isActive ? 'success' : 'neutral'}>
                        {location.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialogState({ mode: 'edit', location })}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {dialogState ? (
        <LocationFormDialog
          key={dialogState.mode === 'edit' ? dialogState.location.id : 'create'}
          organizationId={organizationId}
          location={dialogState.mode === 'edit' ? dialogState.location : null}
          onClose={() => setDialogState(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </Container>
  )
}

function LocationFormDialog({
  organizationId,
  location,
  onClose,
  onSaved,
}: {
  organizationId: string
  location: Location | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const isEdit = Boolean(location)
  const createLocation = useCreateLocation()
  const updateLocation = useUpdateLocation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: location?.name ?? '',
      addressLine1: location?.addressLine1 ?? '',
      addressLine2: location?.addressLine2 ?? '',
      city: location?.city ?? '',
      region: location?.region ?? '',
      postalCode: location?.postalCode ?? '',
      country: location?.country ?? '',
      timezone: location?.timezone ?? guessTimezone(),
      isActive: location?.isActive ?? true,
    },
  })

  async function onSubmit(values: LocationFormValues) {
    setFormError(null)

    const payload: LocationInput = {
      organizationId,
      name: values.name,
      addressLine1: values.addressLine1 || null,
      addressLine2: values.addressLine2 || null,
      city: values.city || null,
      region: values.region || null,
      postalCode: values.postalCode || null,
      country: values.country || null,
      timezone: values.timezone,
      isActive: values.isActive,
    }

    try {
      if (isEdit && location) {
        await updateLocation.mutateAsync({ id: location.id, ...payload })
        onSaved('Location updated')
      } else {
        await createLocation.mutateAsync(payload)
        onSaved('Location created')
      }
    } catch (error) {
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
          <DialogTitle>{isEdit ? 'Edit location' : 'Add location'}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this location's details." : 'Add a new shop location for your organization.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label="Name" error={errors.name?.message} {...register('name')} />
          <TextField label="Address line 1" {...register('addressLine1')} />
          <TextField label="Address line 2" {...register('addressLine2')} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="City" {...register('city')} />
            <TextField label="Region / state" {...register('region')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Postal code" {...register('postalCode')} />
            <TextField label="Country" {...register('country')} />
          </div>
          <TextField
            label="Timezone"
            hint="IANA name, e.g. America/New_York"
            error={errors.timezone?.message}
            {...register('timezone')}
          />
          <Switch label="Active" description="Inactive locations are hidden from booking." {...register('isActive')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? 'Save changes' : 'Add location'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LocationsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
